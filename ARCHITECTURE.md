# RDash Architecture

RDash is a terminal dashboard (TUI) for browsing **and controlling** a ROS graph
(ROS1 & ROS2), plus analysis tools: a native **matplotlib** plot window
(time-series / n-th derivative·integral / FFT / XY-regression / 3D), pub/sub
connection view, TF frame tree, node resource monitor, rosbag record/play,
command bookmarks, and a jobs manager.

Guiding rule: **`index.js` only bootstraps and renders; all logic lives in
separated modules.** `lib/` has no React, `hooks/` own a stream/subprocess,
`components/` render and own their own keyboard input.

## Top-level layout

```
index.js               # ~10-line bootstrap: alt-screen + render(<StoreProvider><Layout/></StoreProvider>)
telemetry.py           # ROS1 graph → 1 JSON line/sec (topics+Hz, services, params, nodes)
telemetry_ros2.py      # ROS2 graph → same JSON "items" format
plot.py                # matplotlib live plotter (time / xy / xyz modes)
tf_tree.py             # /tf(+/tf_static) YAML on stdin → frame-tree text
src/
  react.js             # single place to import React `h` + hooks
  store.js             # central Context store: all shared state, derived values, actions, effects
  lib/                 # pure / side-effecting helpers, NO React
    util.js            #   clamp, pad/padL, sparkline, fuzzy, shq, constants (LEFT_W, RATES, MIN_COLS/ROWS)
    tree.js            #   buildTree / flattenTree (item list → namespace tree)
    ros.js             #   command builders, rosSpawn(env), control actions, numericFields
    commands.js        #   builders for connections / resource / tf / rosbag
    paths.js           #   repo-root paths; loads telemetry(.py), plot.py, tf_tree.py
    env.js             #   host / ROS version / ROS_DOMAIN_ID / RMW context
    bookmarks.js       #   load/save ~/.rdashrc
    screen.js          #   alt-screen enter/restore + exit wiring
  hooks/               # React hooks that own a data stream / subprocess
    useRosVersion.js   #   detect ROS 1 vs 2
    useTopics.js       #   run telemetry(.py) via python3, parse JSON stream (env: RDASH_CTRL, ROS_DOMAIN_ID)
    useValue.js        #   selected item's live value (echo stream / info poll), freeze-aware
    useBandwidth.js    #   `rostopic/ros2 topic bw` for the selected topic
    useTermSize.js     #   terminal cols/rows (resize)
  components/
    Layout.js          #   composition root: size guard / Loading / GlobalKeys + panels + Overlay + EnvBar + Footer
    GlobalKeys.js      #   HEADLESS global/nav key handler (survives tree being hidden)
    TreePanel.js       #   left "file component": namespace tree + Hz sparkline (render only)
    ValuePanel.js      #   right "data component": live value, scroll, bandwidth, freeze
    EnvBar.js          #   host/ROS/domain/rmw/Hz-mode + live REC indicator
    Footer.js          #   compact, mouse-clickable button bar (Help/Find/Jobs/Tree/Quit)
    Overlay.js         #   mounts exactly one mode component (below)
    StatusLine.js      #   default: last action / active filter / action hint
    SearchBar.js       #   '/' fuzzy search input
    ParamEdit.js       #   param set / service-call request input (routes by edit.kind)
    FieldPicker.js     #   plot field multi-select + mode (time / xy / xyz)
    Bookmarks.js       #   bookmark manager (run/add/delete)
    BookmarkAdd.js     #   two-step bookmark add (name → cmd)
    DomainEdit.js      #   ROS_DOMAIN_ID switch input
    BagPlay.js         #   rosbag play path input
    InfoView.js        #   scrollable command output (connections / resource / tf)
    Jobs.js            #   jobs manager (list + output + kill/remove)
    Help.js            #   categorized shortcut reference (?)
    Button.js          #   hover/click mouse button
    Loading.js         #   pre-connection screen
    TooSmall.js        #   terminal-too-small guard (< MIN_COLS×MIN_ROWS)
```

## Data flow

```
ROS environment (sourced shell)
        │
        ▼
telemetry(.py) ── JSON items/sec ──▶ useTopics ──▶ store.topics ──▶ buildTree/flattenTree ──▶ TreePanel
   ▲   (reads RDASH_CTRL file for                       │
   │    selective Hz policy)                            ▼
   │                                   selected item ── useValue (echo/info) ──▶ ValuePanel
store writes RDASH_CTRL                              └─ useBandwidth (bw) ──▶ EnvBar header
   (measure: all/none/[topics])
                                       actions spawn processes ──▶ jobs registry ──▶ Jobs overlay
                                         · p  → FieldPicker → plot.py (echo | plotter)
                                         · R  → ros2 bag record / rosbag record
                                         · b  → bookmarked shell command
                                         · c/t/S → info command → InfoView
```

The UI is driven by the once-per-second telemetry snapshot (the ROS graph) plus
per-selection streams (echo, bandwidth). RDash never links ROS libraries into
Node — it **shells out** to the ROS CLI / rospy·rclpy, inheriting the current
shell's ROS environment (`ROS_MASTER_URI`, `ROS_DOMAIN_ID`, …).

## State & the store

`src/store.js` (`StoreProvider`) is the single source of truth. It:

- calls the data hooks (`useRosVersion`, `useTopics`, `useValue`, `useBandwidth`, `useTermSize`);
- holds all UI state — selection/scroll (`sel`, `top`, `valTop`, `expanded`,
  `active`), mode flags (`edit`, `searching`, `frozen`, `plotPick`, `domainEdit`,
  `bmOpen`, `bmAdd`, `infoView`, `bagPlay`, `jobsOpen`, `help`, `treeHidden`),
  and subsystem state (`hzMode`, `domain`, `rec`, `jobs`, `bookmarks`);
- computes derived values every render (filtered `list`, `flat` rows, panel
  widths — right pane goes full width when `treeHidden`, clamped selection);
- exposes actions (`activate`, `move`, `doAction`, `doRestart`, `submitEdit`,
  `doPlot`/`launchPlot`, `openConnections`/`openTf`/`openResource`, `toggleRec`,
  `runBookmark`, `cycleHz`, `submitDomain`, `killJob`/`removeJob`, `quit`, …);
- runs effects: the mouse handler (scroll + click-to-select via
  `useElementPosition`), the Hz-history ring buffer for sparklines, writing the
  selective-Hz control file, and killing all jobs on unmount;
- provides everything through `DashboardContext`; components read it with
  `useDashboard()`.

Because the whole tree re-renders each telemetry tick anyway, one context value
(recreated per render) is the simplest, cheap choice for a TUI.

## Input handling — routed to the owning component

Ink's `useInput` is global (not DOM focus) and several handlers can be active at
once. RDash exploits this: **each interactive piece owns its keys**, gated by
mode, so input lands in the right place with no central dispatcher.

| Handler        | active when                                   | keys |
|----------------|-----------------------------------------------|------|
| `GlobalKeys`   | no overlay open (headless, always mounted)    | nav (↑↓/jk, Enter, g/G), `/ space p x r c t S R P b J h D Tab ? 1-9 [ ] +/- q` |
| `SearchBar`    | `searching`                                   | text, Enter, Esc, Backspace |
| `ParamEdit`    | `edit`                                         | text, Enter, Esc (param set or service request) |
| `FieldPicker`  | `plotPick`                                     | ↑↓, space (multi-select), Enter (time), `x` (xy/xyz), Esc |
| `Bookmarks`    | `bmOpen`                                       | ↑↓, Enter (run), `a` add, `d` delete, Esc |
| `BookmarkAdd`  | `bmAdd`                                         | text, Enter (next/save), Esc |
| `DomainEdit`   | `domainEdit`                                   | digits, Enter, Esc |
| `BagPlay`      | `bagPlay`                                       | text, Enter, Esc |
| `InfoView`     | `infoView`                                      | ↑↓/PgUp/PgDn scroll, Esc |
| `Jobs`         | `jobsOpen`                                      | ↑↓, `k`/`K` kill, `d` remove, Esc |
| `Help`         | `help`                                          | Esc / `?` |
| `Loading` / `TooSmall` | before connect / terminal too small     | q |

Global keys live in a **headless `GlobalKeys`** component (not `TreePanel`) so
they keep working when the tree is hidden (`Tab`) and its panel is unmounted.
Mouse (scroll / click-to-select / clickable footer buttons) is handled in the
store and the `Button` component.

## Subsystems

### Telemetry & selective Hz
`telemetry.py` / `telemetry_ros2.py` enumerate the graph once per second and emit
a JSON `items` array. They measure per-topic Hz by subscribing:
- ROS1 uses `AnyMsg` (no deserialization);
- ROS2 uses `create_subscription(..., raw=True)` (serialized bytes only — no
  deserialization), falling back to a normal subscription on older rclpy.

RDash writes a small **control file** (`RDASH_CTRL`, a temp path passed via env);
the telemetry polls it each loop and only subscribes to the requested topics
(`h` cycles `all` / `selected`=visible+active / `off`). Subscriptions for topics
that disappear or leave the policy are destroyed — cutting observer-effect
bandwidth and preventing leaks.

### Value / bandwidth
`useValue` streams `topic echo` for topics (throttled to the render-rate cap) and
polls `info`/`param get` for other kinds; `frozenRef` pauses screen updates
(`space`). `useBandwidth` parses `topic bw` for the selected topic.

### The plotter (`plot.py`)
A standalone process decoupled from ROS specifics: it reads a ROS `echo` YAML
stream (or bare scalars) on **stdin**, extracts the requested dotted field(s),
and renders per `--mode`:
- **time** — raw + n-th derivative/integral (`↑`/`↓` change order) + FFT (single
  field); multiple `--field` overlay on one time axis;
- **xy** — parametric/correlation scatter with equal aspect + linear regression
  (`f` toggles); a circular trajectory shows as a circle;
- **xyz** — 3D trajectory (mplot3d) with a current-position marker.

`--save PATH` renders one frame headlessly (Agg) for demos/tests.

### Jobs registry
Every process RDash spawns for the user (bookmarks, rosbag record/play, plots)
goes through `spawnJob(label, cmd)`: the child is tracked with a status
(`run`/`done`/`error`) and a bounded output ring buffer (in a ref to avoid
re-render storms). The `Jobs` overlay (`J`) lists them, shows output, and kills
(SIGINT/SIGKILL) or removes them. `quit` kills every job.

### Container / domain
`EnvBar` shows host / ROS version / `ROS_DOMAIN_ID` / RMW (ROS_MASTER_URI on
ROS1). `D` sets a new `ROS_DOMAIN_ID`, which `useTopics` passes as env and
respawns the telemetry — letting you peek at another container's ROS2 graph
reachable over DDS.

### Terminal size guard
`Layout` renders `TooSmall` below `MIN_COLS×MIN_ROWS` (~65×10, where the two-pane
layout would overflow); resizing larger returns automatically via the resize
listener.

## Design principles

- **`index.js` stays trivial.** Anything with behavior belongs in a module.
- **Separation by concern:** `lib/` = no React; `hooks/` = a stream/subprocess;
  `components/` = render + own input.
- **No hidden ROS knowledge.** RDash assumes only "a shell where ROS works" and
  shells out, inheriting that environment — nothing about Docker/launch/deploy.
- **General-purpose.** Features work on any ROS graph and any numeric field; no
  hard-coded topic names or robot-specific behavior.
- **Headless-friendly.** The TUI needs no X11/Qt; only the optional plot window
  and Gazebo-style GUI tasks need a display (those stay out of scope — RDash is
  orthogonal to RViz/Gazebo GUIs).
