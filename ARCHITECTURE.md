# RDash Architecture

RDash is a terminal dashboard (TUI) for browsing **and controlling** a ROS graph
(ROS1 & ROS2), plus analysis tools: a native **matplotlib** plot window
(time-series / n-th derivative·integral / FFT / XY-regression / 3D), pub/sub
connection view, TF frame tree, node resource monitor, rosbag record/play,
command bookmarks, and a jobs manager. It also ships a **web GUI**
(`backend/` + `frontend/web/`) that reuses the same telemetry/command layer through
a swappable **backend interface** (CLI / single-rclpy-node / remote rosbridge) — see
*Backend interface* and *Web application* below.

Guiding rule: **`index.js` only bootstraps and renders; all logic lives in
separated modules.** `shared/` and `frontend/tui/lib/` have no React, `hooks/` own a
stream/subprocess, `components/` render and own their own keyboard input (grouped
into `common/ chrome/ panels/ overlays/`). The browser side follows the same shape:
`lib/` = no DOM ownership, `panels/` + `views/` = render and own their own input.

`index.js` also, before entering the alt screen, auto-installs the plot's
Python deps (`pydeps.js`) and wraps stdout in a **line-diff writer**
(`diffstdout.js`) so streaming values redraw at the target rate without
flicker (see *Rendering* below).

## Top-level layout

Four top-level buckets. **`shared/` is the load-bearing one**: the TUI and the web
backend are two front doors onto the same ROS command/telemetry layer.

```
index.js               # TUI bootstrap: alt-screen + render(<StoreProvider><Layout/></StoreProvider>);
                       #   also spawns backend/server.js as a silent companion (RDASH_NO_WEB=1 to opt out)

shared/                # used by BOTH the TUI and the web backend. No React, no DOM.
  backend.js           #   RosBackend interface + CliBackend (facade over the builders) + RclNodeBackend / RosbridgeBackend + makeBackend()
  ros.js               #   command builders, rosSpawn(env), killTree/killTreeHard, control actions, numericFields, protoCmd (msg skeleton)
  commands.js          #   builders: connections / resource(CPU·RSS·threads) / tf / rosbag / msg-def / param list·get·set
  rosbridge.js         #   rosbridge_suite websocket client (subscribe / call_service / publish) + msgToYaml / looseJson  [needs `ws`]
  paths.js             #   THE single source of truth for every python script path (see "Python bridges" below)
  msgform.js           #   flatten a message skeleton into labeled fields + rebuild a YAML message (publish form)
  bookmarks.js         #   load/save ~/.rdashrc
  baseline.js          #   snapshot(items) + diffBaseline(base, items) → regression report; ~/.rdash_baseline.json
  preflight.js         #   load ~/.rdash_preflight.json + evaluate checks vs graph
  util.js              #   clamp, pad/padL, sparkline, fuzzy, shq, typable/editable, constants (LEFT_W, RATES, MIN_COLS/ROWS)

backend/               # the web backend (Node). Entry: `npm run web` → node backend/server.js
  server.js            #   34 lines: create http server, wire router + /ws, listen, banner
  ros.js               #   ROS1/2 detection (VER), backend selection (BACKEND/be), tcpOpen, ensureRosbridge, cleanRosCmd
  http.js              #   sse / json / readBody / runOnce / streamLines / streamBlocks / serveFile (serves ../frontend/web)
  telemetry.js         #   rosbridge clients, rbGraphSnapshot, the telemetry SINGLETON, rbEcho, the `measure` set
  mux.js               #   echo multiplexer: one child process fanning out N topic echoes
  jobs.js              #   jobs registry (bookmarks / rosbag / action goals) + the persistent teleop publisher
  ws.js                #   /ws — one websocket multiplexing every browser stream (events/echo/img/cloud/…)
  routes.js            #   every HTTP route (49 of them)
  python/              #   see "Python bridges" below

frontend/
  tui/                 # React Ink TUI  (was src/)
    react.js           #   single place to import React `h` + hooks
    store.js           #   central Context store: all shared state, derived values, actions, effects
    lib/               #   TUI-only helpers (the shared ones moved to shared/)
      tree.js          #     buildTree / flattenTree (item list → namespace tree)
      complete.js      #     ROS command autocomplete engine
      graph.js         #     node topology from telemetry edges
      session.js       #     ~/.rdash_session.json (UI state) + ~/.rdash_history
      doctor.js        #     diagnose(items): QoS mismatch / stale / dead-end rules → ranked issues
      env.js           #     host / ROS version / ROS_DOMAIN_ID / RMW context
      screen.js        #     alt-screen enter/restore + exit wiring
      diffstdout.js    #     line-diff writer: rewrite only changed lines (flicker-free at target rate)
      pydeps.js        #     auto-install plot deps (numpy/matplotlib/PyYAML) before the TUI starts
    hooks/             #   React hooks that own a data stream / subprocess
      useRosVersion.js useTopics.js useValue.js useBandwidth.js
      useWatches.js useRosout.js useDiagnostics.js useTermSize.js
    components/        #   grouped by role; each renders + owns its own keyboard input
      common/          #     Button.js List.js OverlayFrame.js
      chrome/          #     Layout.js (composition root) GlobalKeys.js EnvBar.js Footer.js TooSmall.js
      panels/          #     TreePanel.js (namespace tree + Hz sparkline) · ValuePanel.js (live value, bandwidth, freeze)
      overlays/        #     Overlay.js router + 25 overlays: SearchBar ParamEdit PublishForm FieldPicker
                       #     Bookmarks BookmarkAdd DomainEdit BagPlay TfEcho BagCompare WatchList Preflight
                       #     InfoView Jobs GraphView QoSView LogViewer DiagnosticsView ParamPanel
                       #     LifecycleView SystemOverview DoctorView BaselineView TeleopView Help StatusLine

  web/                 # browser. Native ES modules — NO bundler, NO build step.
    index.html         #   shell: dark theme, toolbar, modal container, graph controls, PlotLab styles.
                       #   Loads exactly one script: <script type="module" src="/main.js">
    main.js            #   bootstrap: open /events, build toolbar, bind keys + graph pan/zoom, expose window.RD
    lib/
      dom.js           #     el() / $ / api / post / spinner / emptyState
      stream.js        #     the /ws multiplex client: openStream(path, onData), decodeCloud, wsEverOpen
      state.js         #     THE shared mutable state — a single `state` object (see "Browser state" below)
      theme.js clock.js diagnose.js baseline.js trigger.js modal.js
    panels/
      sidebar.js       #     collapsible namespace tree (+ tells the server which topics are on screen → Hz)
      info.js          #     selected-item info block (type / Hz / pubs / subs / param value)
      value.js         #     live value + plot + gauge (numeric()/leaves() parse the YAML echo)
    views/
      graph.js         #     rqt_graph-style node graph: force layout, drag, pan/zoom, filters
      scene3d.js       #     raw-WebGL 3D scene (grid/axes/TF/markers/pointcloud) + the 3D modal
      plotlab.js       #     multi-plot lab (derivative/integral/FFT/XY, bag load, pop-out via popup.html)
      image.js map.js inspect.js actions.js streams.js health.js bookmarks.js
      index.js         #     assembles the `Views` object the toolbar/keys dispatch into
    workspace.js       #   docking tile-panel layout (also a module now — no globals)
    popup.html         #   standalone pop-out plot window (own SSE, own transforms)
```

### Why `shared/` exists

`backend/server.js` and `frontend/tui/store.js` both need the same thing: "build
me the ROS command for X" and "give me the graph". Ten modules serve both, so they
live in `shared/` and neither side reaches into the other. If you add a module,
ask: does the TUI *and* the web backend need it? Then it is `shared/`. Only one?
Then it belongs to that side.

### Python bridges (`backend/python/`)

```
backend/python/
  common/ros_compat.py   # ROS1(rospy) / ROS2(rclpy) shim — 8 bridges import it
  telemetry/             # telemetry.py, telemetry_ros2.py  → graph snapshot stream
  scene3d/               # marker_bridge, geom_bridge, urdf_bridge, im_bridge, cloud_bridge, tf_dump
  image/                 # img_bridge (Image→JPEG), img_ann_bridge, caminfo_bridge
  stream/                # ros_echo_mux.py — one rclpy node echoing N topics (kills process-per-topic)
  tools/                 # plot.py (matplotlib), bag_dump.py, tf_tree.py
```

Two rules, both easy to trip over:

1. **`shared/paths.js` is the ONLY place a python path is written.** Everything
   else imports a constant from it. Moving a script = editing one file.
2. **The bridges are spawned as `python3 <abs-path>`, so `sys.path[0]` is the
   script's own directory** — a bridge in `scene3d/` cannot `import ros_compat`
   from `common/` on its own. `rosSpawn()` (`shared/ros.js`) puts `PY_COMMON` on
   `PYTHONPATH` for every spawn, which is what makes it work. If you ever spawn
   python without going through `rosSpawn`, you must do the same.

`telemetry.py` is the exception: it is read into a string (`TELEM`) and piped to
`python3 -` over stdin, so it has no path dependency at all (and can run on a
remote shell with no repo checked out).

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

### Telemetry over rosbridge (`backend/telemetry.js`) — and why it is shaped this way

The web backend defaults to `RDASH_BACKEND=rosbridge`, so it cannot run the python
telemetry script; it rebuilds the same `items` snapshot from `/rosapi/*` service
calls. That path is a performance minefield and the current design exists because
every naive version of it collapsed. Do not "simplify" these four things back:

1. **Edges come from `/rosapi/node_details`, one call per NODE — never per topic.**
   The obvious implementation calls `/rosapi/publishers` + `/rosapi/subscribers`
   for every topic: on a 146-topic graph that is **295 rosapi calls per second**.
   rosapi cannot serve that (it pegged at 46% CPU and rosbridge at 109%), calls
   started timing out, and the UI flickered. Inverting `node_details` (7 nodes → 7
   calls) gives the identical edge set — verified against the master's
   `getSystemState()` — in ~10 calls/tick.
2. **A timeout must never be read as "empty".** `RosbridgeClient.call()` resolves
   `null` after 4s. Treating `null` as `[]` produced a snapshot with zero nodes,
   and since the browser replaces `items` wholesale, every node vanished from the
   screen for a frame. Now: if `/rosapi/topics` fails the whole tick is skipped
   (the browser keeps what it has); if `nodes`/`services`/`node_details` fail, the
   last good value is reused. `{nomaster:true}` is only sent when the websocket is
   genuinely down.
3. **In-flight guard.** The 1s `setInterval` skips its tick if the previous
   snapshot has not returned. Without it, slow snapshots overlapped and landed out
   of order.
4. **One poll loop for the whole process, ref-counted.** `rbTelemetryCore(send)`
   registers a callback in a module-level set; the first subscriber starts the
   loop, the last one to leave stops it and drops every Hz subscription. It used to
   build a fresh loop per SSE client, so two browser tabs doubled the load on ROS.

**Hz on the rosbridge path is opt-in.** rosbridge JSON-serializes every message it
forwards, so subscribing to all 146 topics just to count them is what pinned it at
109% CPU (the CLI path is free by comparison: it counts with `AnyMsg` / `raw=True`
and never deserializes). So the browser POSTs `/api/measure` with the topics
actually drawn on screen, and only those get subscribed. Everything else reports
`hz: null, age: null`, which the UI renders as blank — **`null` means "not
measured", NOT "0 Hz"**. `snapProfile`/`diffBaseline` must keep skipping nulls or
Baseline reports a false `12.0→0.0 (-100%)` regression for every off-screen topic.

### `RosbridgeClient` reconnect invariants (`shared/rosbridge.js`)

`ensureRosbridge` restarts rosbridge_server whenever it dies, so **the client must
survive its server vanishing mid-flight**. It did not, and the failure was silent
and permanent (the backend froze; only a process restart recovered it). Three rules
keep it working — do not remove them:

1. **`connect()` is guarded.** Two things call it: the client's own `_retry()`
   (1.5 s) and the watchdog in `backend/telemetry.js` (2 s). Without a
   `readyState`-based guard both open sockets, and then **an old socket's `close`
   handler sets `ready = false` on a perfectly good new socket**. Once `ready` is
   false, `_send()` only queues, so every service call sits there and times out
   after 4 s — the process looks alive, rosapi looks idle, and nothing works.
2. **Every listener checks `this.ws !== sock` and bails.** A stale socket's events
   must never touch shared state.
3. **`open` re-subscribes.** rosbridge forgets our subscriptions when it restarts;
   the client still holds the callbacks, so nothing errors — the data just stops.
   `subscribe()` therefore remembers the message type (`topicTypes`) and `open`
   re-sends every `subscribe`, and clears `_advertised` so the next `publish()`
   re-advertises.

The regression test that proves this: start a fake rosbridge, subscribe, kill it,
restart it on the same port, then assert the server sees the `subscribe` again,
exactly one connection, and that `call()` still resolves. Against the pre-fix code
that test fails on re-subscribe (0) and connection count (2).

### Browser state (`frontend/web/lib/state.js`)

ES module imports are read-only bindings: `import { items }` then `items = …` is a
`TypeError`. Since `items`/`sel`/`selItem`/`marked`/`hideAnon` are reassigned from
several modules, they live as properties of one exported `state` object and
everyone reads/writes `state.items`. Same reason `lib/modal.js` exposes
`getActiveModal()`/`setModalSub()` instead of exporting the bindings.

Related: modules reference each other in cycles (`sidebar ↔ info`, `value ↔ views`).
ES modules tolerate cycles for **hoisted `function` declarations** but throw TDZ
errors for `const fn = () => {}`. Every cross-module function is therefore declared
with `function`. Keep it that way.

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

### Web application (backend + browser + bridges)

`backend/` is a thin HTTP/WS layer over the same infrastructure: it serves the
static browser modules, exposes the telemetry graph and per-topic echo as streams
and the one-shot queries/actions as **JSON** endpoints (all built via `be`), and
keeps a server-side **jobs registry** (bookmarks / rosbag / action goals / a single
persistent Teleop publisher). Sensor data that the CLI can't stream cheaply comes
from the python **bridges** under `backend/python/`. `index.js` also spawns the web
server as a silent companion so `npm start` boots both (opt out with
`RDASH_NO_WEB=1`; the TUI's `EnvBar` shows the web URL and a `🔴 TRIG` indicator
when a trigger is armed).

**Two different websockets, do not confuse them.** `backend/ws.js` serves `/ws` —
that is *browser ↔ RDash server*, one connection multiplexing every stream
(events / echo / image / pointcloud) so the browser doesn't open a socket per
panel. `shared/rosbridge.js` is *RDash server ↔ ROS* (rosbridge_suite, port 9090).
The TUI uses neither: it spawns ROS CLI processes directly (see *Backend split*).

`frontend/web/` renders: the **node graph** (nodes-only / bipartite rqt_graph modes
with services=diamonds, actions=hexagons, filter bar), the right-hand
value/plot/**gauge**, **PlotLab** (multi-plot, drag-resize, pop-out via
`popup.html`, shared time cursor + scrub, n-th derivative/integral, FFT via an
in-page radix-2 transform, XY, custom-expression curves, bag load), and a modal
system for every TUI tool plus the GUI-native views (**Doctor**/**Baseline** reuse
the same rules as the TUI, ported to the browser; **Trigger**, **Teleop**, **Map**,
**Image**, **3D** in raw WebGL, **State Transitions**). The browser talks only to
`backend/`, so the ROS backend (cli/rcl/rosbridge) is transparent to it.

It is **plain ES modules, deliberately** — no bundler, no build step, no npm
install to see a change. Adding React would mean adding a bundler (React 18 is CJS;
browsers can't resolve bare specifiers), and half of this code — WebGL, canvas
plots, the SVG force layout, binary pointcloud decode — is inherently imperative
and would keep living behind refs anyway.

### Backend split: the TUI and the web do NOT share a data source

This surprises everyone, so it is worth stating plainly:

| | data source | set by |
|---|---|---|
| TUI | **ROS CLI** — spawns `rostopic`/`rosnode`/`python3 telemetry.py` | `RDASH_TUI_BACKEND=cli` (forced in `index.js`) |
| Web | **rosbridge** websocket :9090 | `RDASH_BACKEND=rosbridge` (forced for the child in `index.js`) |

The TUI cannot currently use rosbridge: `store.js` executes every ROS action as a
*command string* → `spawnJob`/`runOnce`, and `RosbridgeBackend` extends
`CliBackend`, so its `publish()` still returns a CLI string. The real rosbridge
client wiring lives only in `backend/telemetry.js`. Unifying the two (so the TUI
can attach to a remote robot with no ROS CLI, and publish/teleop drops from a
multi-second process respawn to ~0.2 ms) is the outstanding work tracked in
`ROSBRIDGE_TUI_TODO.md`. Note that local-only features (node CPU/RSS, rosbag
record, process kill) have no meaning over a remote rosbridge and must be disabled
in that mode.

## Development & verification

There is no test runner, no bundler, and no linter checked in. What there *is* is a
set of cheap checks that catch the mistakes this codebase actually makes. Run them
before you claim something works — especially on the browser side, where a broken
module fails **silently** (blank panel, no stack trace anywhere you'd look).

**Static — catches ~everything mechanical:**

```bash
# 1. syntax, all of it
for f in $(find . -name '*.js' -not -path './node_modules/*'); do node --check "$f"; done

# 2. "used but never imported" in the browser modules.
#    ESM already fails at LINK time on a missing export; no-undef catches the other half.
npx --yes eslint@9 --no-config-lookup --config <cfg> frontend/web    # want: 0 errors

# 3. does the module graph actually resolve?
node --input-type=module -e "import('./frontend/web/main.js').catch(e => console.log(e.constructor.name + ': ' + e.message))"
#    ReferenceError: location is not defined  → GOOD. Every import resolved; evaluation began.
#    SyntaxError (missing export) / ERR_MODULE_NOT_FOUND → REAL failure.
```
(The eslint config only needs `sourceType: module` + browser globals + `no-undef`.
It is not checked in on purpose — it is a verification tool, not a style gate.)

**Live — the checks that actually found bugs:**

```bash
# the graph snapshot, once per second. Watch for flicker: node/service counts must NOT oscillate.
curl -sN localhost:8080/events

# ground truth to compare it against (this is what the CLI backend sees):
python3 -c "import rosgraph; p,s,v = rosgraph.Master('/x').getSystemState(); \
  print('edges', sum(len(n) for _,n in p) + sum(len(n) for _,n in s))"

# is rosbridge drowning? >100% CPU on rosbridge_websocket means someone is subscribing to everything.
top -b -n1 -p $(pgrep -f rosbridge_websocket) -p $(pgrep -f rosapi_node)
```

**Browser, headless — the only way to prove the UI boots:**

```bash
msedge --headless=new --disable-gpu --screenshot=out.png \
       --window-size=1700,1000 --virtual-time-budget=12000 http://localhost:8080
```
Look at the PNG. A blank sidebar means a module threw. Add `--enable-logging=stderr`
to see the exception.

### Traps that have already cost someone an afternoon

- **`pgrep -f "node backend/server.js"` matches the shell running it.** Your own
  `bash -c` command line contains that string, so `pkill -9 -f` kills *itself*
  (exit 137) and you conclude the server is unkillable. Put the command in a script
  file, or match by pid from `ps`.
- **`ws` is a real dependency** (`backend/ws.js`, `shared/rosbridge.js`). It is now
  in `package.json`; it used to be present only transitively via `ink`, which meant
  a hoisting change would have silently broken the web server.
- **A bridge in `backend/python/<subdir>/` cannot `import ros_compat`** unless it
  was spawned through `rosSpawn` (which sets `PYTHONPATH`). Test the real path, not
  `python3 <script>` by hand — by hand it fails, through the app it works, and the
  reverse mistake is easy to make too.
- **`hz: null` ≠ `hz: 0`.** null = not measured (topic off-screen). Any code that
  does `t.hz || 0` will invent a dead topic.

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
