# RDash

A terminal dashboard (TUI) for browsing **ROS topics / services / params / nodes** with live values — for **ROS1 and ROS2**. Built with [React Ink](https://github.com/vadimdemedes/ink).

> **What it's like:** the closest analogue is **rqt** (`rqt_graph` + `rqt_topic` + `rqt_reconfigure` + `rqt_service_caller`) — graph *introspection **and** control* — but in a **single terminal**: headless / SSH-friendly, no X11 or Qt. It ships an optional **browser GUI** (`npm start`) that covers **rqt_graph + PlotJuggler + parts of Foxglove/RViz** territory — node/topic graph, a multi-plot lab, camera/GPS/pointcloud views — and can drive a **remote** robot over rosbridge. See [Web UI](#web-ui-localhost).

```
╭ RDash        102 ╮ ╭ /iris/imu [topic] 99Hz            3-20/45 ↕ ╮
│ ▶ services       │ │ header:                                     │
│ ▶ params         │ │   stamp: {...}                              │
│ ▼ topics         │ │ orientation:                                │
│   ▶ mavros       │ │   x: 0.0012  y: -0.003 ...                  │
│   ● /iris/imu 99 │ │ angular_velocity: ...                       │
│ ▶ nodes          │ │                                             │
╰──────────────────╯ ╰─────────────────────────────────────────────╯
 ↑↓ move | Enter select | p plot | c conn | t tf | b marks | ? help | q quit
```

## Features
- **File-tree browser** of the ROS graph: `topics/`, `services/`, `params/`, `nodes/` (expand/collapse).
- **Live values** on the right pane, dispatched by kind:
  - topic → `rostopic echo` / `ros2 topic echo` (streaming)
  - param → `rosparam get`
  - service → `rosservice info` / `ros2 service type`
  - node → `rosnode info` / `ros2 node info`
- **Live Hz** per topic (incl. subscriber-only topics, marked `(sub)`), with a **mini Hz sparkline** (recent history) in the tree.
- **Bandwidth** (bytes/s) for the selected topic (`rostopic bw` / `ros2 topic bw`), shown in the value-pane header.
- **Fuzzy search** (`/`) to filter the tree by name — folders auto-expand to reveal matches (`Esc` clears).
- **Freeze** the value pane (`space`) to inspect a fast-scrolling message without it moving.
- **Plotting** (`p` on a topic): opens a native **matplotlib** window fed by the topic's echo stream (multiple windows allowed). General-purpose — works on any numeric field(s):
  - **time** mode: raw value + **n-th derivative / integral** (`↑`/`↓` in the window; e.g. velocity→acceleration) + **FFT** spectrum. Multiple fields overlay on one time axis. A **sliding time window** (last N seconds; `+`/`-` change it by 5s) keeps the span predictable regardless of topic rate.
  - **xy** mode (2 fields): parametric/correlation plot with equal aspect (a circular trajectory shows as a circle) + **linear regression** line & R² (toggle with `f`).
  - **xyz** mode (3 fields): 3D trajectory.
  - Pick fields in the picker: `space` to multi-select, `Enter` for time, `x` for spatial (2=XY, 3=3D). Requires `python3` with `numpy`/`matplotlib` and a display.
- **Watch list** (`w`): pin numeric fields from several topics and see them all live in one panel — no windows, works headless/SSH.
- **Message age / latency**: the tree marks topics that stopped publishing (red `⚠`); the value header shows the active topic's `header.stamp` latency (ms) or arrival age (s), color-coded — dead sensor / sync issues at a glance.
- **Preflight / health check** (`F`): evaluate expected conditions (topic present + min Hz, node up, service up) against the live graph → ✓/✗ checklist. "Is the stack ready before arming?" Checks live in `~/.rdash_preflight.json`.
- **Jobs manager** (`J`): every process RDash spawns (bookmarks, rosbag, plots) is tracked — view its output, kill (SIGINT/SIGKILL), or remove it. All jobs are killed on quit.
- **Connection view** (`c`): publishers/subscribers of a topic, or a node's in/out topics. **Node graph** (`n`): a terminal rqt_graph — the selected node's publish/subscribe topology (who it talks to), or the whole-graph edge list. **TF frame tree** (`t`), **tf echo between two frames** (`T`), and **node resource monitor** (`S`, live CPU%/RSS/threads, CPU-sorted).
- **Diagnostics & introspection** for real debugging: **log viewer** (`L`, live `/rosout` with level & text filter), **diagnostics** (`v`, `/diagnostics` aggregated by status), **message definition** (`m`, `interface show`), **QoS inspect** (`Q`, per-endpoint reliability/durability + flags the RELIABLE-vs-BEST_EFFORT mismatch that silently drops messages), and a **system overview** (`O`, "ROS htop": node CPU/RSS + topic Hz + stale + preflight). The tree also marks dead-end topics (published but no subscribers `⇢`, or vice-versa `⇠`).
- **Param tuning panel** (`o` on a ROS2 node): list the node's parameters and set them live (edit or `+`/`-` nudge ±10%) — an rqt_reconfigure in the terminal. **Lifecycle** (`V` on a node): run managed-node transitions (configure/activate/…). **Action client**: ROS2 actions appear under `actions/`; `x` sends a goal and streams feedback into Jobs.
- **🩺 Doctor** (`H`): a one-key **auto-diagnosis** of the whole graph — QoS reliability/durability mismatches, stale topics, dead-end publishers (no subscriber), subscribers waiting on a missing publisher — ranked by severity; `Enter` jumps to the offending topic. Something neither rqt nor RViz does, powered by data RDash already collects.
- **📌 Baseline / regression** (`K`): `b` saves a "known-good" profile (node list, topic Hz, services); reopening diffs it against live and flags a **vanished node, disappeared topic, or collapsed publish rate** — field/CI debugging in one screen. Persisted to `~/.rdash_baseline.json` (shared with the web).
- **🔴 Trigger recording** (`A`): arm a watchdog; when the graph goes unhealthy (a Doctor ERROR appears) it **auto-snapshots** the marked topics (cooldown-gated). Event-driven capture, on the robot.
- **🎮 Teleop** (`W`): drive a robot over plain SSH — `W/A/S/D`/arrows publish `geometry_msgs/Twist` (a held `-r 10 Hz` publisher), `Space` stops, `+`/`-` adjust speed.
- **Multi-select & snapshot**: mark topics with `.` (shown `*`); `R` records just those, `X` snapshots their current values to a file for a bug report. Copy the selected name to the clipboard with `y` (OSC52, works over SSH).
- **Session memory**: expanded folders, watches, mode, and last selection are restored on the next run; the bookmark editor recalls command history with `Ctrl+P`/`Ctrl+N`.
- **rosbag** — record (`R`) the filtered topics (or `-a`) with a live REC indicator; play (`P`) a bag by path; **A/B compare** (`B`) two bags' info side by side.
- **Help overlay** (`?`) with categorized shortcuts, and **`Tab`** to hide the tree so the value pane spans full width.
- **Command bookmarks** (`b`): name frequently-used shell commands (launch scripts, canned publishes like arm/disarm) and run them — by number key `1`-`9`,`0`, from the scrollable list (Enter or **double-click**), any number of them. Add/`e`dit them in a **multi-line command editor** built to be easier than a shell: **paste** support (multi-line), **Ctrl+Space** autocomplete (ROS subcommands + topic/node/service/package names), cursor editing, **Ctrl+S** to save. Persisted per-container to `~/.rdashrc`.
- **Selective Hz measurement** (`h` cycles `all`/`selected`/`off`): only subscribe to the topics you're looking at (or none), cutting the observer-effect bandwidth of measuring every topic. High-rate topics are counted via raw (non-deserialized) subscriptions.
- **Container / domain awareness**: an env bar shows host, ROS version, `ROS_DOMAIN_ID`, and RMW. `D` switches `ROS_DOMAIN_ID` and reconnects — to peek at another container's ROS2 graph reachable over DDS.
- **Control actions** (`x` on a selection): **publish to a topic via a field form** — the message type's fields are listed (`linear.x`, `angular.z`, …) so you fill values instead of hand-typing YAML; kill node (ROS1 `rosnode kill`; ROS2 SIGINT by node→PID, best-effort); **call a service with a request argument** (YAML/JSON, e.g. Gazebo `spawn_entity` / `set_entity_state`); set param — the rqt-style *control* half.
- **ROS1 & ROS2 auto-detected** from the environment.
- **Keyboard + mouse**: hover highlight on tree rows and footer buttons, click to select/expand, **double-click a bookmark to run it**, wheel to scroll.
- **Flicker-free rendering**: a line-diff writer repaints only the lines that changed, so high-rate values (and hover) update at the target rate without the whole screen blinking — even on slower terminals (WSL / Windows Terminal). Configurable **max render rate**.

## Web UI (localhost)

Some things read better as a real GUI than in a terminal — the **node graph**,
**plots**, and **sensor views** especially. RDash ships a web server that reuses
the exact same telemetry/echo pipeline and serves a full browser UI on
localhost. **`npm start` boots both** the TUI and the web server together (the
TUI shows `web:localhost:8080` in its env bar); or run the web alone:

```bash
npm start          # TUI + web together  (opt out of web: RDASH_NO_WEB=1)
npm run web        # web only → http://localhost:8080   (RDASH_WEB_PORT to change)
```

**Running in a container?** The server binds to `0.0.0.0` (all interfaces) by
default, so the web UI is reachable **from the host** as long as the port is
exposed — publish it (`docker run -p 8080:8080 …`) or share the host network
(`docker run --network host …`, common when the container also talks to ROS).
Then open `http://<host-ip>:8080`. Lock it to loopback with
`RDASH_WEB_HOST=127.0.0.1`.

The web UI has **full parity** with the TUI plus GUI-native views:

- **▦ Docking workspace** — a tiled multi-panel layout (mosaic) for seeing
  several views at once, in the spirit of Foxglove's panel workspace. Split any
  panel **right** (⇥) or **down** (⤓), drag the dividers to resize, close (✕) or
  add (＋) panels. Seven panel types — **Topic graph** (force layout), **Plot**
  (live, click-toggle legend), **Raw messages**, **Image** (annotation +
  calibration overlays), **3D scene** (cloud + markers + TF), **Diagnostics**,
  **Log** — each with its own topic selector; the **layout persists** to
  localStorage. Opened from the header (▦ 워크스페이스).
- **Light / dark theme** toggle (🌙/☀️, persisted; follows the system setting by
  default), plus corner **toasts** (성공/경고/오류) and a live **connection
  badge** (연결됨 / 재연결 중 / 끊김).
- **Node graph (rqt_graph-class).** Two modes via a toolbar toggle: **노드**
  (nodes joined by topic edges, labeled with topic count, weighted thickness)
  and **노드+토픽** (bipartite — topics become their own ellipse nodes with
  publish/subscribe edges). **Services** render as blue diamonds from their
  server node, **actions** as purple hexagons (server→action→client, derived
  from `/_action/*`). A filter bar toggles services / actions / tf / debug
  (`/rosout`,`/parameter_events`) / dead-end topics. Collision-free force
  layout; **wheel-zoom / drag-pan**, drag nodes, click to focus, hover an edge
  for the topic list.
- **PlotLab** (📈) — a **PlotJuggler-class** multi-plot dashboard: multiple
  synchronized plots (세로 / 격자 / 3열, each **drag-resizable** by its ⤡
  corner, or **pop-out** ⧉ into its own window); curves from **any topic/field**
  dragged or clicked onto any plot; a **shared time axis + cursor**, wheel-zoom,
  drag-pan, follow toggle, and a **scrub timeline** (play / 0.25–4× speed) over
  the buffered history; per-curve **transforms** (원값, **n-th** d/dt, **n-th**
  ∫dt, |x|, moving-avg), **FFT** spectrum, **XY** phase plots, **custom
  expression** curves (`c0-c1`, `Math.hypot(c0,c1)`, …), live per-curve
  statistics, **CSV/PNG export** (⭳ CSV for all curves, ⭳ per-plot PNG), and
  **rosbag load** (`🗀 bag`) to replay a recorded file on the scrubber. The
  right-hand quick panel also has a live value view, a small line plot, and a
  **gauge** (radial dial, auto-ranged).
- **RDash-unique diagnostics** (things Foxglove/rviz don't do — RDash already
  has the graph data and shell access):
  - **🩺 Doctor** (`H`) — one-key health scan of the whole graph: QoS
    reliability/durability mismatches, stale topics, publisher-with-no-subscriber
    dead-ends, subscriber-with-no-publisher, ranked by severity, click to jump.
  - **📌 Baseline** (`K`) — save a "known-good" profile (nodes / topic Hz /
    services) and diff live against it: a vanished node, a disappeared topic, or
    a collapsed publish rate are flagged. Shared file with the TUI.
  - **🔴 Trigger** (`A`) — arm a watchdog that auto-captures (snapshot / rosbag)
    when a condition fires (graph ERROR, `/diagnostics` ERROR), with cooldown.
  - **📊 Node processes** (`P`) — live per-node CPU% / RSS / thread count
    (CPU-sorted) with per-node kill / restart.
- **🎮 Teleop** — a `geometry_msgs/Twist` D-pad + WASD/arrow keys with
  adjustable linear/angular speed (a persistent `-r 10 Hz` publisher).
- **Sensor views** (all rendered locally — no external tiles, no WebGL libs):
  - **🗺 Map** — NavSatFix lat/lon track.
  - **🖼 Image** — Compressed/Image camera stream with **annotation overlays**
    (`vision_msgs/Detection2D(Array)` boxes + labels/score, `foxglove_msgs/
    ImageAnnotations` points/circles/texts) and **calibration overlays**
    (`sensor_msgs/CameraInfo` principal-point reticle + `K`/`D` readout).
    **Wheel-zoom / drag-pan** with a **pixel (x,y)+rgb** readout.
  - **🧊 3D scene (RViz-class)** — a full raw-**WebGL** scene (no three.js) with
    an RViz-style **Displays panel**: add **multiple** topics at once, **checkbox
    show/hide** (unchecking unsubscribes to save bandwidth), remove, and a **＋
    add-topic** picker; built-in **Grid / Axes / TF / RobotModel** toggles.
    Renders:
    - **PointCloud2** with **color modes** — height (z) / **intensity** (jet) /
      **RGB** / flat, auto-detected from the cloud's fields.
    - **`Marker(Array)`** (cube / sphere / cylinder / arrow / line / points /
      text / **triangle-list mesh**, with transparency), TF-placed by `frame_id`.
    - **TF frames** (RGB axes + labels).
    - **Native message displays** — **LaserScan**, **Path**, **Odometry**,
      **PoseArray**, **PoseStamped**, **PointStamped**, **OccupancyGrid**
      (via `geom_bridge.py`).
    - **RobotModel** — parses `robot_description` **URDF** (box/cylinder/sphere
      primitives + **STL meshes**), each link posed by its TF frame.
    - **Interactive tools** (🛠) — ground-plane click picking: **Publish Point**
      (`/clicked_point`), **Nav Goal** (`/goal_pose`), **Pose Estimate**
      (`/initialpose`), and **Measure** (distance between two points).
    - **Camera / frame** — **Fixed Frame** (re-anchor everything to a chosen
      frame), **Follow** (camera tracks a TF frame), **Orthographic** projection,
      orbit / zoom / pan, **camera presets** (Top / Front / Side / Iso).
    - **FPS + point count** overlay and a **wallclock + simulation-time**
      readout (`/clock`).
    - **Point-cloud LOD** (selectable ⚙): server voxel downsample
      (`RDASH_CLOUD_VOXEL`) + **shader distance LOD** (keep a `lodDist/depth`
      fraction past a threshold via a stable hash, survivors enlarged), with
      **Off / Distance / Adaptive** (auto-tune to hold a target FPS) modes, a
      max-points cap, and round/square points.
- **State Transitions** — a topic field's value changes as a colored timeline
  (enums / booleans / modes). Plus the full TUI toolset: publish form (skeleton
  prefill), service call, QoS, msg def, connections, TF tree, param table,
  lifecycle, `/rosout` log, `/diagnostics`, system overview, bookmarks, and a
  server-side jobs registry.

### Backends (`RDASH_BACKEND`)

RDash talks to ROS through a swappable **`RosBackend`** interface, so the same UI
runs against different data sources:

| backend | how it talks to ROS | when |
|---|---|---|
| `cli` | shells out to `ros2`/`ros` CLI (one process per stream) | local, simplest |
| `rcl` | a single **rclpy** node multiplexes all topic echoes into one process | local, many plotted topics — kills the `ros2 topic echo` process fan-out |
| `rosbridge` | a **websocket** client to `rosbridge_suite` (`RDASH_ROSBRIDGE_URL=ws://robot:9090`) | remote robot, no local ROS install |

**The TUI and the web currently use different backends, on purpose:**

| | default | override |
|---|---|---|
| TUI | `cli` — spawns ROS CLI processes | `RDASH_TUI_BACKEND` |
| Web | `rosbridge` — auto-starts `rosbridge_server` on :9090 if it isn't up | `RDASH_WEB_BACKEND` |

`npm start` sets both (see `index.js`). The TUI cannot use `rosbridge` yet —
`store.js` runs every ROS action as a command string, so `RosbridgeBackend.publish()`
still returns CLI text. Unifying them is tracked in `ROSBRIDGE_TUI_TODO.md`.

Runs in a ROS-sourced shell like the TUI. Sensor streams use python bridges under
`backend/python/` (`scene3d/`, `image/`, `stream/`, `tools/`); every path is
declared in `shared/paths.js` and each is overridable by env (`RDASH_TELEM`,
`RDASH_IMG_BRIDGE`, `RDASH_CLOUD_BRIDGE`, …).

### Repo layout

```
index.js       TUI entry (also spawns the web server; RDASH_NO_WEB=1 to skip)
shared/        used by BOTH the TUI and the web backend — ROS command builders,
               rosbridge client, paths.js (the only place python paths are written)
backend/       web backend (node backend/server.js) + python/ bridges by function
frontend/tui/  React Ink TUI
frontend/web/  browser — native ES modules, no bundler, no build step
```

See **ARCHITECTURE.md** for the full map, the rosbridge telemetry design (and why
it must not be "simplified"), and the verification commands.

## Requirements
- **Node.js ≥ 18**
- A shell where **ROS works** (`rostopic`/`rospy` for ROS1, or `ros2` for ROS2) — i.e. run it after `source`-ing your ROS setup. RDash inherits that environment; it knows nothing about how ROS is deployed (native, Docker, …).
- **Python plot deps** (`numpy` / `matplotlib` / `PyYAML`, see `requirements.txt`): **auto-installed on first run** if missing (the install log shows, then press Enter to start). Opt out with `RDASH_NO_AUTOPIP=1` and install manually with `pip install -r requirements.txt`.
- **Per-feature (optional):**
  - Plotting (`p`): the Python deps above, plus a display for the window (the **web** PlotLab needs neither — it renders in the browser).
  - rosbag (`R`/`P`): `ros2 bag` / `rosbag` on `PATH`.
  - Bandwidth / resource monitor: standard `ros2 topic bw` / `rostopic bw`, `ps`, `/proc`.
  - Web is **zero-extra-dep** on the `cli` backend (uses Node's built-ins). `RDASH_BACKEND=rcl` uses ROS2's bundled `rclpy` (no build); the web camera/pointcloud/bag panels use `rclpy` / `rosbag2_py`. `RDASH_BACKEND=rosbridge` needs `rosbridge_suite` running on the robot, nothing extra locally.

## Install
```bash
npm install
```

## Usage
Run it in a ROS-sourced shell:
```bash
# ROS1
source /opt/ros/noetic/setup.bash
npm start                 # TUI + web (http://localhost:8080); web off with RDASH_NO_WEB=1

# ROS2
source /opt/ros/humble/setup.bash
node index.js             # TUI only (npm start also launches the web server)
```

### Navigation
| Key / Mouse | Action |
|---|---|
| `↑↓` / `j` `k` | move selection |
| `Enter` / click | expand folder / select item |
| `/` | fuzzy-search the tree (`Esc` clears) |
| `x` | control the selection: **publish to topic (field form)** / call service / kill node / set param |
| `p` | plot the selected topic (matplotlib: raw / n-th d·∫ / FFT / XY+regression / 3D) |
| `b` / `1`-`9`,`0` | bookmarks: open manager / run bookmark by shortcut (Enter or double-click in the list; `a` add, `e` edit) |
| `J` | jobs manager (view output / kill spawned processes) |
| `w` | watch list (pin fields from several topics) |
| `F` | preflight / health check (✓/✗ vs `~/.rdash_preflight.json`) |
| `c` / `n` | connections (pub/sub) / **node graph (topology)** |
| `t` / `T` / `S` / `O` | TF tree / tf echo (two frames) / node resource monitor / **system overview (ROS htop)** |
| `L` / `v` | **log viewer (/rosout)** / **diagnostics (/diagnostics)** |
| `m` / `Q` / `y` | **message definition** / **QoS inspect** / copy name (clipboard) |
| `o` / `V` | **param tuning panel** (ROS2 node) / **lifecycle** transition (ROS2 node) |
| `H` / `K` / `A` | **🩺 Doctor** (graph health scan) / **📌 Baseline** (regression diff) / **🔴 Trigger** arm (auto-capture on ERROR) |
| `W` | **🎮 Teleop** — drive with WASD (publishes `geometry_msgs/Twist`) |
| `.` / `X` | mark topic (multi-select) / **snapshot** marked topics to a file |
| `R` / `P` / `B` | rosbag record toggle (marked topics if any) / play (path) / A·B compare |
| `h` | cycle Hz measurement: all / selected / off |
| `D` | switch `ROS_DOMAIN_ID` (view another container's graph) |
| `Tab` | hide/show the tree (value pane full width) |
| `?` | help overlay (all shortcuts) |
| `space` | freeze / unfreeze the value pane |
| wheel | scroll (over left = tree, over right = value) |
| `[` `]` | scroll value pane |
| `g` / `G` | top / bottom |
| `+` `-` | change max render rate |
| `q` | quit |

### Config (env)
| Var | Default | Meaning |
|---|---|---|
| `RENDER_HZ` | `10` | max screen refresh rate (1–60) |
| `ROS_VER` | auto | force `1` or `2` |
| `ROS_DOMAIN_ID` | inherited | ROS2 domain (also switchable at runtime with `D`) |
| `RDASH_MOUSE` | `1` | set `0` to disable mouse entirely (for terminals where mouse tracking misbehaves) |
| `RDASH_DIFF` | `1` | line-diff rendering (flicker-free); set `0` to fall back to Ink's default full-frame writes |
| `RDASH_NO_AUTOPIP` | `0` | set `1` to skip auto-installing the Python plot deps on startup |
| `RDASH_PYTHON` | `python3` | interpreter used for telemetry / plot / autocomplete / dep install |
| `RDASH_WEB_PORT` | `8080` | web server port |
| `RDASH_WEB_HOST` | `0.0.0.0` | web bind address; `127.0.0.1` to restrict to loopback (host can't reach it) |
| `RDASH_CLOUD_VOXEL` | `0` | point-cloud voxel downsample size in metres (0 = off); e.g. `0.05` → one point per 5 cm cell |
| `RDASH_CLOUD_MAXN` | `30000` | max points per cloud frame sent to the browser (uniform decimation past this) |
| `RDASH_NO_WEB` | `0` | set `1` so `npm start` launches the TUI **without** the companion web server |
| `RDASH_BACKEND` | `rosbridge` (web) | data source: `cli` / `rcl` (single rclpy echo mux) / `rosbridge` (websocket) |
| `RDASH_TUI_BACKEND` | `cli` | TUI's backend, independent of the web's |
| `RDASH_WEB_BACKEND` | `rosbridge` | web's backend, independent of the TUI's |
| `RDASH_ROSBRIDGE_URL` | `ws://localhost:9090` | rosbridge endpoint when the backend is `rosbridge` |
| `RDASH_TELEM` | — | override the telemetry script (web); `RDASH_IMG_BRIDGE`/`RDASH_CLOUD_BRIDGE`/`RDASH_BAG_DUMP`/`RDASH_ECHO_MUX`/`RDASH_MARKER_BRIDGE`/`RDASH_TF_DUMP`/`RDASH_IMG_ANN_BRIDGE`/`RDASH_CAMINFO_BRIDGE` override the sensor/echo bridges |

### Files
- `requirements.txt` — Python plot deps (auto-installed on first run).
- `~/.rdashrc` — saved command bookmarks (JSON).
- `~/.rdash_preflight.json` — preflight check definitions, e.g. `{"checks":[{"type":"topic","name":"/livox/imu","minHz":150},{"type":"node","name":"/fast_lio_mapping"}]}`.
- `~/.rdash_session.json` — restored UI state (expanded folders, watches, mode, last selection).
- `~/.rdash_baseline.json` — saved "known-good" profile for Baseline/regression (`K` / web 📌), shared by TUI and web.
- `~/.rdash_history` — command history for the bookmark editor.
- `rdash_rec_<ts>` / `rdash_snapshot_<ts>.txt` — rosbag recordings (`R`) / value snapshots (`X`).

## Testing
Provide some ROS data, then run RDash in another shell.
```bash
# ROS1 (needs a display for turtlesim)
bash test/test_turtlesim.sh

# ROS2 (turtlesim if X11 available, else headless demo nodes)
bash test/test_ros2.sh
```

### Verifying a change

There is no test runner. Before claiming a change works — especially in
`frontend/web/`, where a broken module fails **silently** (blank panel, no visible
stack trace):

```bash
# syntax, everything
for f in $(find . -name '*.js' -not -path './node_modules/*'); do node --check "$f"; done

# does the browser module graph resolve? (missing export → SyntaxError at link time)
node --input-type=module -e "import('./frontend/web/main.js').catch(e => console.log(e.constructor.name + ': ' + e.message))"
#   "ReferenceError: location is not defined" is the GOOD answer — it linked, then hit a browser global.

# the graph stream: node/service counts must stay STEADY, never oscillate
curl -sN localhost:8080/events

# prove the UI actually boots (look at the PNG — a blank sidebar means a module threw)
msedge --headless=new --disable-gpu --screenshot=out.png --virtual-time-budget=12000 http://localhost:8080
```

ARCHITECTURE.md has the full list, plus the traps (`pgrep -f` matching its own
shell, `PYTHONPATH` for the python bridges, `hz: null` ≠ `hz: 0`).

## Notes
- ROS2 params are per-node (no global param server), so a `params/` category only appears on ROS1.
- ROS2 CLI graph queries use a background daemon; if the tree is empty, run `ros2 daemon stop && ros2 daemon start`.

## License
MIT
