# RDash Architecture

RDash is a terminal dashboard (TUI) for browsing and controlling a ROS graph
(ROS1 & ROS2), with an optional native **matplotlib** plotting window for
time-series / spectrum analysis.

The codebase is split into a thin entrypoint, a set of ROS telemetry scripts,
a React-Ink UI decomposed into small components, and a standalone Python
plotter. The guiding rule: **`index.js` only bootstraps and renders; all logic
lives in separated modules.**

## Top-level layout

```
index.js              # ~10-line bootstrap: alt-screen + render(<StoreProvider><Layout/></StoreProvider>)
telemetry.py          # ROS1 graph → 1 JSON line/sec (topics+Hz, services, params, nodes)
telemetry_ros2.py     # ROS2 graph → same JSON "items" format
plot.py               # matplotlib live plotter (raw / n-th derivative·integral / FFT)
src/
  react.js            # single place to import React `h` + hooks
  store.js            # central Context store: all shared state, derived values, actions, effects
  lib/                # pure/side-effecting helpers, no React
    util.js           #   clamp, pad, sparkline, fuzzy, shq, constants (LEFT_W, RATES)
    tree.js           #   buildTree / flattenTree (item list → namespace tree)
    ros.js            #   command builders, rosSpawn, control actions, numericFields
    paths.js          #   repo-root paths; loads telemetry.py / telemetry_ros2.py once
    screen.js         #   alt-screen enter/restore + exit wiring
  hooks/              # React hooks that own a data stream / subprocess
    useRosVersion.js  #   detect ROS 1 vs 2
    useTopics.js      #   run telemetry(.py) via python3, parse JSON stream
    useValue.js       #   selected item's live value (echo stream / info poll), freeze-aware
    useBandwidth.js   #   `rostopic/ros2 topic bw` for the selected topic
    useTermSize.js    #   terminal cols/rows (resize)
  components/         # presentational + input-owning components
    Layout.js         #   composition root: Loading OR (TreePanel + ValuePanel) + Overlay + Footer
    TreePanel.js      #   left "file component": namespace tree + navigation/global keys
    ValuePanel.js     #   right "data component": live value, scroll, bandwidth, freeze
    Overlay.js        #   mounts exactly one of the mode components below
    SearchBar.js      #   '/' fuzzy search input (owns its keys)
    ParamEdit.js      #   ROS1 param set input (owns its keys)
    FieldPicker.js    #   plot field picker (owns its keys)
    StatusLine.js     #   default status / filter / action hint
    Footer.js         #   key hints + mouse Quit button
    Button.js         #   hover/click mouse button
    Loading.js        #   pre-connection screen
```

## Data flow

```
ROS environment (sourced shell)
        │
        ▼
telemetry(.py)  ── JSON items/sec ──▶  useTopics ──▶ store.topics
        │                                              │
        │                              buildTree/flattenTree → flat rows
        │                                              │
        ▼                                              ▼
selected item ── useValue (echo/info) ──▶ store.echo ──▶ ValuePanel
              ── useBandwidth (bw)     ──▶ store.bw
              └─ 'p' → FieldPicker → launchPlot:
                     `ros2/rostopic echo <topic>` | python3 plot.py --field a.b.c
                                                          │
                                                          ▼
                                        matplotlib window (raw / d·∫ / FFT)
```

The UI is driven entirely by the once-per-second telemetry snapshot (the ROS
graph) plus per-selection streams (echo, bandwidth). RDash never talks to ROS
directly — it shells out to the ROS CLI / rospy·rclpy, inheriting the current
shell's ROS environment (`ROS_MASTER_URI`, `ROS_DOMAIN_ID`, …).

## State & the store

`src/store.js` is the single source of truth. `StoreProvider`:

- calls the data hooks (`useRosVersion`, `useTopics`, `useValue`, …),
- holds all UI state (`sel`, `top`, `expanded`, `active`, mode flags: `edit`,
  `searching`, `frozen`, `plotPick`, …),
- computes derived values every render (filtered `list`, `flat` rows, panel
  widths, clamped selection/scroll),
- exposes actions (`activate`, `move`, `doAction`, `doRestart`, `doPlot`,
  `launchPlot`, `quit`),
- runs the mouse effect (scroll + click-to-select) and cleanup (kill spawned
  plots on exit),
- provides everything via `DashboardContext`.

Components read what they need with `useDashboard()`. Because the whole tree
re-renders on each telemetry tick anyway, a single context value (recreated per
render) is simplest and cheap for a TUI.

## Input handling — routed to the owning component

Ink's `useInput` is global (not DOM-style focus), and multiple `useInput`
handlers can be active at once. RDash uses this to make **each component own its
own keys**, gated by mode so input lands in the right place:

| Component     | `useInput` active when                          | Keys |
|---------------|--------------------------------------------------|------|
| `TreePanel`   | no overlay (`!edit && !plotPick && !searching`)  | ↑↓/jk, Enter, x, p, r, /, space, +/-, [ ], g/G, q |
| `SearchBar`   | `searching` (mounted only then)                  | text, Enter, Esc, Backspace |
| `ParamEdit`   | `edit` (mounted only then)                       | text, Enter, Esc, Backspace |
| `FieldPicker` | `plotPick` (mounted only then)                   | ↑↓, Enter, Esc |
| `Loading`     | before topics connect                            | q |

`Overlay.js` mounts exactly one mode component, so its `useInput` becomes the
active one and `TreePanel`'s gate turns off — no central dispatcher, no double
handling. Mouse (scroll/click) is handled once in the store because it needs
the tree element's screen position (`useElementPosition`).

## The plotter (`plot.py`)

A standalone Python process, intentionally decoupled from ROS specifics: it
reads a ROS `echo` YAML stream (or bare scalars) on **stdin**, extracts one
dotted field path, and renders three stacked axes:

1. **raw value** vs time
2. **n-th derivative / integral** — `up`/`down` change the order (positive =
   derivative, e.g. velocity→acceleration; negative = integral; `0` = raw)
3. **FFT magnitude** — recent window, resampled to a uniform grid, Hann-windowed

`--save PATH` renders one frame headlessly (Agg) for demos/tests. RDash spawns
it via `launchPlot`, tracks the child, and kills it on quit.

## Design principles

- **`index.js` stays trivial.** Anything with behavior belongs in a module.
- **Separation by concern:** `lib/` = no React; `hooks/` = a stream/subprocess;
  `components/` = render + own input.
- **No hidden ROS knowledge.** RDash assumes only "a shell where ROS works" and
  inherits that environment; it shells out rather than binding to ROS libs in
  Node.
- **Headless-friendly.** The TUI needs no X11/Qt; only the optional plot window
  needs a display.
