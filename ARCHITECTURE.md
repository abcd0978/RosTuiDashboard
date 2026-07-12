# RDash Architecture

RDash is a terminal dashboard (TUI) for browsing **and controlling** a ROS graph
(ROS1 & ROS2), plus analysis tools: a native **matplotlib** plot window
(time-series / n-th derivative·integral / FFT / XY-regression / 3D), pub/sub
connection view, TF frame tree, node resource monitor, rosbag record/play,
command bookmarks, and a jobs manager. It also ships an optional **web GUI**
(`web/`) that reuses the same telemetry/command layer through a swappable
**backend interface** (CLI / single-rclpy-node / remote rosbridge) — see
*Backend interface* and *Web application* below.

Guiding rule: **`index.js` only bootstraps and renders; all logic lives in
separated modules.** `lib/` has no React, `hooks/` own a stream/subprocess,
`components/` render and own their own keyboard input (grouped into
`common/ chrome/ panels/ overlays/`).

`index.js` also, before entering the alt screen, auto-installs the plot's
Python deps (`pydeps.js`) and wraps stdout in a **line-diff writer**
(`diffstdout.js`) so streaming values redraw at the target rate without
flicker (see *Rendering* below).

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
    util.js            #   clamp, pad/padL, sparkline, fuzzy, shq, typable/editable, constants (LEFT_W, RATES, MIN_COLS/ROWS)
    tree.js            #   buildTree / flattenTree (item list → namespace tree)
    ros.js             #   command builders, rosSpawn(env), killTree/killTreeHard, control actions, numericFields, protoCmd (msg skeleton)
    msgform.js         #   flatten a message skeleton into labeled fields + rebuild a YAML message (publish form)
    complete.js        #   ROS command autocomplete engine (subcommands + topic/node/service/pkg names)
    graph.js           #   node topology from telemetry edges (node-centric / whole-graph)
    session.js         #   ~/.rdash_session.json (UI state) + ~/.rdash_history (command history)
    commands.js        #   builders: connections / resource(CPU·RSS·threads) / tf / rosbag / msg-def / param list·get·set
    backend.js         #   RosBackend interface + CliBackend (facade over the builders) + RclNodeBackend / RosbridgeBackend + makeBackend()
    doctor.js          #   diagnose(items): QoS mismatch / stale / dead-end rules → ranked issues (Doctor)
    baseline.js        #   snapshot(items) + diffBaseline(base, items) → regression report; ~/.rdash_baseline.json
    rosbridge.js       #   dependency-free rosbridge_suite websocket client (subscribe / call_service / publish) + msgToYaml / looseJson
    paths.js           #   repo-root paths; loads telemetry(.py), plot.py, tf_tree.py, and bridge script paths
    env.js             #   host / ROS version / ROS_DOMAIN_ID / RMW context
    bookmarks.js       #   load/save ~/.rdashrc
    preflight.js       #   load ~/.rdash_preflight.json + evaluate checks vs graph
    screen.js          #   alt-screen enter/restore + exit wiring
    diffstdout.js      #   line-diff writer: rewrite only changed lines (flicker-free at target rate)
    pydeps.js          #   auto-install plot deps (numpy/matplotlib/PyYAML) before the TUI starts
  hooks/               # React hooks that own a data stream / subprocess
    useRosVersion.js   #   detect ROS 1 vs 2
    useTopics.js       #   run telemetry(.py) via python3, parse JSON stream (env: RDASH_CTRL, ROS_DOMAIN_ID)
    useValue.js        #   selected item's live value (echo stream / info poll), freeze-aware
    useBandwidth.js    #   `rostopic/ros2 topic bw` for the selected topic
    useWatches.js      #   watch-list: one echo per watched topic → latest field values
    useRosout.js       #   /rosout log stream → ring buffer (log viewer)
    useDiagnostics.js  #   /diagnostics DiagnosticArray → per-component status map
    useTermSize.js     #   terminal cols/rows (resize)
  components/          # grouped by role; each renders + owns its own keyboard input
    common/            #   reusable building blocks
      Button.js        #     hover/click footer button (live-bounds press hit-test)
      List.js          #     scrollable selectable list: selection + hover + click-select + double-click-activate
      OverlayFrame.js  #     bordered box + title/hint header (overlay chrome)
    chrome/            #   app frame
      Layout.js        #     composition root: size guard / GlobalKeys + panels|modal + inline overlay + EnvBar + Footer
      GlobalKeys.js    #     HEADLESS global/nav key handler (survives tree being hidden)
      EnvBar.js        #     host/ROS/domain/rmw/Hz-mode + live REC indicator
      Footer.js        #     bottom hint line ("? = 전체 단축키 · 마우스 …"); keyboard-centric (buttons removed)
      TooSmall.js      #     terminal-too-small guard (< MIN_COLS×MIN_ROWS)
    panels/            #   main split view
      TreePanel.js     #     left "file component": namespace tree + Hz sparkline + hover highlight
      ValuePanel.js    #     right "data component": live value, scroll, bandwidth, freeze
    overlays/          #   the Overlay router + every overlay / input mode
      Overlay.js       #     mounts exactly one mode component (below)
      StatusLine.js    #     default: last action / active filter / action hint
      SearchBar.js     #     '/' fuzzy search input
      ParamEdit.js     #     param set / service-call request input (routes by edit.kind)
      PublishForm.js   #     topic publish: fields derived from the message type, fill values (x on a topic)
      FieldPicker.js   #     plot/watch field multi-select + mode (time / xy / xyz) — uses common List
      Bookmarks.js     #     bookmark manager (run/add/edit/delete) — uses common List (double-click runs)
      BookmarkAdd.js   #     bookmark add/edit: multi-line command editor + paste + Ctrl+Space autocomplete
      DomainEdit.js    #     ROS_DOMAIN_ID switch input
      BagPlay.js       #     rosbag play path input
      TfEcho.js        #     two-frame input → live transform (T)
      BagCompare.js    #     two bag-path input → side-by-side bag info (B)
      WatchList.js     #     watch-list overlay: pinned fields + live values (w) — uses common List
      Preflight.js     #     health-check overlay: expected conditions ✓/✗ (F)
      InfoView.js      #     scrollable command output (connections / resource / tf / bag compare)
      Jobs.js          #     jobs manager (list + output + kill/remove) — uses common List
      GraphView.js     #     node topology (n) · QoSView.js QoS+mismatch (Q)
      LogViewer.js     #     live /rosout with level/text filter (L) · DiagnosticsView.js /diagnostics (v)
      ParamPanel.js    #     ROS2 param list + live set/nudge (o) · LifecycleView.js transitions (V)
      SystemOverview.js #    "ROS htop": nodes+topics+preflight in one screen (O)
      DoctorView.js    #     🩺 graph auto-diagnosis, severity-ranked (H) — uses lib/doctor.js
      BaselineView.js  #     📌 baseline save + regression diff (K) — uses lib/baseline.js
      TeleopView.js    #     🎮 WASD → geometry_msgs/Twist publisher (W)
      Help.js          #     categorized shortcut reference (?)
```

The **web application** (`web/`) reuses the same `src/lib` builders/telemetry
and is a thin API + single-page GUI (see *Web application* below):

```
web/
  server.js          # HTTP + SSE server: static files, telemetry/echo/img/cloud streams, JSON action/query API, jobs registry, echo-mux + rosbridge relay
  app.js             # single-file SPA: node graph (rqt_graph modes), value/plot/gauge, PlotLab, Doctor/Baseline/Trigger, Teleop, Map/Image/3D(WebGL), all TUI modals
  index.html         # shell: dark theme, toolbar, modal container, graph controls, PlotLab styles
  popup.html         # standalone pop-out plot window (own SSE, own transforms)
img_bridge.py        # CompressedImage/Image → base64 JPEG stream (Image panel)
cloud_bridge.py      # PointCloud2 → base64 float32 xyz stream (3D panel)
bag_dump.py          # rosbag2 (sqlite3/mcap) → numeric leaf time-series JSON (PlotLab bag load)
ros_echo_mux.py      # single rclpy node echo multiplexer (RclNodeBackend — one process for N topics)
```

Beyond the tree/value browse+control core, RDash covers a real debugging loop:
a terminal **node graph** (rqt_graph), a live **/rosout log viewer** and
**/diagnostics** aggregator, **message-definition** and **QoS** inspection
(flagging the RELIABLE↔BEST_EFFORT mismatch), a **param tuning** panel
(rqt_reconfigure), **lifecycle** and **action** clients, a **system overview**,
plus quality-of-life (marked-topic recording/snapshot, clipboard, session +
command-history persistence). Telemetry now also emits per-topic pub/sub edges
(with QoS on ROS2), which power the graph, the QoS view, and the tree's
dead-end (`⇢`/`⇠`) marks.

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
  `active`, `hoverIdx`), mode flags (`edit`, `searching`, `frozen`, `plotPick`,
  `domainEdit`, `bmOpen`, `bmAdd`, `infoView`, `bagPlay`, `jobsOpen`, `help`,
  `watchOpen`, `preflightOpen`, `tfEcho`, `bagCmp`, `pubForm`, `graphOpen`,
  `qosOpen`, `logOpen`, `paramPanel`, `overviewOpen`, `diagOpen`, `lifeOpen`,
  `teleopOpen`, `doctorOpen`, `baselineOpen`, `treeHidden`),
  and subsystem state (`hzMode`, `domain`, `rec`, `jobs`, `bookmarks`, `pkgNames`,
  `baseline`, `triggerArmed`);
- computes derived values every render (filtered `list`, `flat` rows, panel
  widths — right pane goes full width when `treeHidden`, clamped selection);
- exposes actions (`activate`, `move`, `doAction`, `doRestart`, `submitEdit`,
  `openPublishForm`/`submitPubForm`, `doPlot`/`launchPlot`, `openConnections`/
  `openTf`/`openResource`, `toggleRec`, `runBookmark`, `addBookmark`/
  `updateBookmark`/`deleteBookmark`, `cycleHz`, `submitDomain`,
  `killJob`/`removeJob`, `quit`, …);
- runs effects: the mouse handler (scroll + click-to-select + tree-row hover via
  `useElementPosition`, gated by a `busyRef` so an open overlay doesn't drive the
  hidden tree), a background `ros2 pkg list` fetch for autocomplete, the
  Hz-history ring buffer for sparklines, writing the selective-Hz control file,
  and killing all jobs on unmount;
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
| `GlobalKeys`   | no overlay open (headless, always mounted)    | nav (↑↓/jk, Enter, g/G), `/ space p x r c n m Q y L o O v V t T S R P B b w J F H K A W h D Tab ? 1-9 [ ] +/- q` |
| `DoctorView` / `BaselineView` / `TeleopView` | `doctorOpen` / `baselineOpen` / `teleopOpen` | ↑↓/Enter (jump); `b` save baseline; WASD/arrows drive, Space stop, +/- speed |
| `SearchBar`    | `searching`                                   | text, Enter, Esc, Backspace |
| `ParamEdit`    | `edit`                                         | text, Enter, Esc (param set or service request) |
| `PublishForm`  | `pubForm`                                      | ↑↓ fields, type value, Enter (publish once), Esc |
| `FieldPicker`  | `plotPick`                                     | ↑↓/click, space/double-click (multi-select), Enter (time), `x` (xy/xyz), Esc |
| `Bookmarks`    | `bmOpen`                                       | ↑↓/click, Enter/double-click (run), `a` add, `e` edit, `d` delete, Esc |
| `BookmarkAdd`  | `bmAdd`                                         | text + paste, Ctrl+Space (autocomplete dropdown), Enter (newline/next), Ctrl+S (save), Tab (field), Esc |
| `DomainEdit` / `BagPlay` | `domainEdit` / `bagPlay`             | text, Enter, Esc |
| `TfEcho` / `BagCompare` | `tfEcho` / `bagCmp`                  | two-step text input, Enter/Esc |
| `WatchList`    | `watchOpen`                                     | ↑↓, `a` add, `d` remove, Esc |
| `Preflight`    | `preflightOpen`                                 | Esc |
| `InfoView`     | `infoView`                                      | ↑↓/PgUp/PgDn scroll, Esc |
| `Jobs`         | `jobsOpen`                                      | ↑↓, `k`/`K` kill, `d` remove, Esc |
| `Help`         | `help`                                          | Esc / `?` |
| `TooSmall`     | terminal too small (< MIN_COLS×MIN_ROWS)        | q |

Global keys live in a **headless `GlobalKeys`** component (not `TreePanel`) so
they keep working when the tree is hidden (`Tab`) and its panel is unmounted.
Mouse for the tree (scroll / hover / click-to-select) is handled in the store;
footer buttons hover/click via `Button`; list overlays get hover + click-select
+ double-click-activate from the shared `common/List` (each hit-tests the mouse
against its own rendered rows via `useElementPosition`). Text inputs accept
**paste** (multi-char / multi-line) through `editable()`, which still filters out
mouse-report and escape-sequence noise.

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

### Rendering — flicker-free at the target rate
Ink regenerates the **whole frame string** on any state change and, if that
frame's height reaches the terminal's, clears the entire screen each time. Two
things keep streaming values (e.g. a 30 Hz pose) smooth:

1. **`Layout` is pinned to `rows-1` height with `overflow: hidden`.** The frame
   can never reach the terminal height, so Ink never takes its full-screen-clear
   branch. Big overlays (Jobs / Help / publish form / bookmarks) **replace** the
   panel area instead of stacking on top of the full-height tree; small input
   bars (search / edit) stay inline. `EnvBar`+`Footer` are pinned at the bottom.
2. **`diffstdout.js` wraps stdout with a line diff.** It intercepts the frame Ink
   hands to `log-update`, compares it line-by-line to the previous frame, and
   rewrites **only the changed lines in place** (no erase-then-write). A value
   update repaints ~1–2 lines instead of the whole frame — so hover highlights
   and high-rate values update at full rate with no flicker. Disable with
   `RDASH_DIFF=0`.

### Publish form (message skeleton from the type)
`x` on a topic opens `PublishForm` instead of a raw-YAML prompt. `protoCmd`
(`ros.js`) gets a default-filled skeleton for the topic's message type — ROS2 via
`ros2 interface proto`, ROS1 via `roslib` introspection — as JSON `{type, skel}`.
`msgform.js` flattens that into labeled leaf fields (`linear.x`, `linear.y`, …);
the user fills only the values, and `buildYaml()` reassembles a flow-YAML message
for `topic pub`. Falls back to free YAML input if the type can't be resolved.

### Bookmark command editor & autocomplete
`BookmarkAdd` is a multi-line command editor (cursor, arrows, paste). Its goal is
"easier than typing in a shell": **Ctrl+Space** opens a completion dropdown from
`complete.js`, which knows ROS2/ROS1 subcommands and pulls topic/node/service
names from the data the store already holds (package names come from a one-shot
`ros2 pkg list`). ↑↓ pick, Enter inserts, and typing re-filters live. **Ctrl+S**
saves (safe under Ink's raw mode, which disables IXON flow control). Edit mode
(`bmAdd.editIdx`, opened with `e`) reuses the form and writes back in place,
keeping the hotkey. Bookmark hotkeys are the first free digit of `1-9,0`; entries
past ten run from the list (Enter or double-click).

### Common list overlay
`common/List` is the shared list widget behind Bookmarks / Jobs / WatchList /
FieldPicker: a scroll window that follows the selection, selection + mouse-hover
highlight, and mouse **single-click = select / double-click = activate** (each
list hit-tests against its own rows). `common/OverlayFrame` is the shared bordered
box + title/hint header. Callers keep their own `useInput` for feature keys and
pass `items / idx / onSelect / onActivate / renderRow`.

### Python deps auto-install
`pydeps.js` runs before the alt screen: it import-checks `numpy` / `matplotlib` /
`PyYAML` and pip-installs only the missing ones (plain → `--user` →
`--break-system-packages` fallback), then waits for Enter so the install log is
readable before the TUI takes over. No-ops silently once present. Opt out with
`RDASH_NO_AUTOPIP=1`; choose the interpreter with `RDASH_PYTHON`. The canonical
list is `requirements.txt` (telemetry's `rospy`/`rclpy` come from ROS, not pip).

### Killing spawned processes
`killTree` signals a job's process **group** plus every `/proc` descendant (so a
`bash -c` pipeline dies whole). `killTreeHard` (used for `K`) sends SIGINT first
and only SIGKILLs whatever is still alive after a grace period — `roslaunch`
puts each node in its own session via `setsid`, so an instant SIGKILL would
orphan the nodes and leak their ports.

### Message age / latency
The telemetry scripts record each topic's last-arrival time and emit `age`
(seconds since last message). The tree marks topics that were publishing but went
stale (`age > 3s`) with a red `⚠`. The value header shows the active topic's
`header.stamp` latency (ms) when wall-clock stamped (absurd values → fall back to
arrival age, so sim-time stamps don't mislead).

### Watch list
`useWatches` (mounted only while the `w` overlay is open) subscribes one `echo`
per distinct watched topic and extracts each pinned field with `fieldValue()` at
~3 Hz — many live values in one panel, no windows, headless-friendly. Fields are
pinned via the shared `FieldPicker` in `target: 'watch'` mode.

### Health check (preflight)
`preflight.js` loads checks from `~/.rdash_preflight.json` and `evalCheck()`
scores each (topic present + min Hz, node up, service up) against the live graph;
the `F` overlay renders ✓/✗ and turns green when all pass.

### Command palette files (config loaders)
Two tiny JSON loaders read from `$HOME`, each `readFileSync` + `JSON.parse` with a
graceful empty fallback: `bookmarks.js` (`~/.rdashrc`, bookmarks list, also saved)
and `preflight.js` (`~/.rdash_preflight.json`, check definitions, read-only).
These are the only user-editable config files. (`RDASH_CTRL` is a separate
runtime control file RDash *writes* for selective-Hz — not user config.)

### TF echo & A/B bag compare
`T` and `B` open two-step text inputs (`TfEcho`, `BagCompare`); on submit they run
`tf2_echo <src> <tgt>` (refreshing) / `ros2 bag info` on two paths and show the
result in the shared `InfoView`.

### Container / domain
`EnvBar` shows host / ROS version / `ROS_DOMAIN_ID` / RMW (ROS_MASTER_URI on
ROS1). `D` sets a new `ROS_DOMAIN_ID`, which `useTopics` passes as env and
respawns the telemetry — letting you peek at another container's ROS2 graph
reachable over DDS.

### Terminal size guard
`Layout` renders `TooSmall` below `MIN_COLS×MIN_ROWS` (~65×10, where the two-pane
layout would overflow); resizing larger returns automatically via the resize
listener.

### Backend interface (`lib/backend.js`)

All ROS operations go through a `RosBackend` interface so the data source is
swappable without touching UI/server code. `CliBackend` (default) is a facade
over the existing `commands.js`/`ros.js` builders — it just returns shell command
strings. Both the web server and the TUI store build their commands through a
`be = makeBackend(ver)` instance, chosen by `RDASH_BACKEND`:

- **`cli`** — one `ros2/ros` process per stream (echo, bw, …). Simplest.
- **`rcl`** — `usesMux=true`: the server routes `/echo`,`/rosout`,`/diagnostics`
  through **one** `ros_echo_mux.py` rclpy node (stdin `+topic`/`-topic`,
  ref-counted fan-out), instead of one `ros2 topic echo` per topic — killing the
  process explosion when many topics are plotted. Actions stay on the CLI
  builders (inherited from `CliBackend`).
- **`rosbridge`** — `kind='rosbridge'`: the server becomes a `RosbridgeClient`
  (`lib/rosbridge.js`, on Node's global WebSocket, no deps) to a remote
  `rosbridge_suite`. `/events` is built from rosapi (`/rosapi/topics|nodes|
  services|publishers|subscribers`, Hz measured over live subscriptions); echo
  subscribes over WS; publish/service/connections use rosbridge/rosapi. Lets a
  browser drive a **remote** robot with no local ROS.

`RclNodeBackend`/`RosbridgeBackend` extend `CliBackend`, so unimplemented ops
gracefully fall back to CLI builders. The interface is verified with mocks
(mock echo-mux, mock rosbridge WS server) without a real ROS install.

### Web application (server + SPA + bridges)

`web/server.js` is a thin HTTP/SSE layer over the same infrastructure: it serves
the static SPA, exposes the telemetry graph and per-topic echo as **SSE**
streams and the one-shot queries/actions as **JSON** endpoints (all built via
`be`), and keeps a server-side **jobs registry** (bookmarks / rosbag / action
goals / a single persistent Teleop publisher). Sensor data that the CLI can't
stream cheaply comes from small path-configurable **bridges**: `img_bridge.py`
(Compressed/Image → base64 JPEG), `cloud_bridge.py` (PointCloud2 → base64
float32 xyz), `bag_dump.py` (rosbag2 → numeric time-series), `ros_echo_mux.py`
(the rcl echo mux). `index.js` also spawns the web server as a silent companion
so `npm start` boots both (opt out with `RDASH_NO_WEB=1`; the TUI's `EnvBar`
shows the web URL and a `🔴 TRIG` indicator when a trigger is armed).

`web/app.js` is a single-file SPA (its own tiny DOM/`el()` + SSE helpers, no
framework) that renders: the **node graph** (nodes-only / bipartite rqt_graph
modes with services=diamonds, actions=hexagons, filter bar), the right-hand
value/plot/**gauge**, **PlotLab** (multi-plot, drag-resize, pop-out via
`popup.html`, shared time cursor + scrub, n-th derivative/integral, FFT via an
in-page radix-2 transform, XY, custom-expression curves, bag load), and a modal
system for every TUI tool plus the GUI-native views (**Doctor**/**Baseline**
reuse the same `lib/doctor.js`/`lib/baseline.js` rules ported to the browser,
**Trigger**, **Teleop**, **Map**, **Image**, **3D** in raw WebGL, **State
Transitions**). The browser talks only to `web/server.js` over SSE/JSON, so the
backend (cli/rcl/rosbridge) is transparent to it.

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
