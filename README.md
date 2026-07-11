# RDash

A terminal dashboard (TUI) for browsing **ROS topics / services / params / nodes** with live values — for **ROS1 and ROS2**. Built with [React Ink](https://github.com/vadimdemedes/ink).

> **What it's like:** the closest analogue is **rqt** (`rqt_graph` + `rqt_topic` + `rqt_reconfigure` + `rqt_service_caller`) — graph *introspection **and** control* — but in a **single terminal**: headless / SSH-friendly, no X11 or Qt. It is **orthogonal to RViz**, which does 3D sensor/geometry *visualization*, not graph control.

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
- **Connection view** (`c`): publishers/subscribers of a topic, or a node's in/out topics (rqt_graph-lite). **TF frame tree** (`t`), **tf echo between two frames** (`T`), and **node resource monitor** (`S`, CPU%/RSS).
- **rosbag** — record (`R`) the filtered topics (or `-a`) with a live REC indicator; play (`P`) a bag by path; **A/B compare** (`B`) two bags' info side by side.
- **Help overlay** (`?`) with categorized shortcuts, a **clickable footer** button bar, and **`Tab`** to hide the tree so the value pane spans full width.
- **Command bookmarks** (`b`): name frequently-used shell commands (launch scripts, canned publishes like arm/disarm) and run them — by number key `1`-`9`,`0`, from the scrollable list (Enter or **double-click**), any number of them. Add/`e`dit them in a **multi-line command editor** built to be easier than a shell: **paste** support (multi-line), **Ctrl+Space** autocomplete (ROS subcommands + topic/node/service/package names), cursor editing, **Ctrl+S** to save. Persisted per-container to `~/.rdashrc`.
- **Selective Hz measurement** (`h` cycles `all`/`selected`/`off`): only subscribe to the topics you're looking at (or none), cutting the observer-effect bandwidth of measuring every topic. High-rate topics are counted via raw (non-deserialized) subscriptions.
- **Container / domain awareness**: an env bar shows host, ROS version, `ROS_DOMAIN_ID`, and RMW. `D` switches `ROS_DOMAIN_ID` and reconnects — to peek at another container's ROS2 graph reachable over DDS.
- **Control actions** (`x` on a selection): **publish to a topic via a field form** — the message type's fields are listed (`linear.x`, `angular.z`, …) so you fill values instead of hand-typing YAML; kill node (ROS1 `rosnode kill`; ROS2 SIGINT by node→PID, best-effort); **call a service with a request argument** (YAML/JSON, e.g. Gazebo `spawn_entity` / `set_entity_state`); set param — the rqt-style *control* half.
- **ROS1 & ROS2 auto-detected** from the environment.
- **Keyboard + mouse**: hover highlight on tree rows and footer buttons, click to select/expand, **double-click a bookmark to run it**, wheel to scroll.
- **Flicker-free rendering**: a line-diff writer repaints only the lines that changed, so high-rate values (and hover) update at the target rate without the whole screen blinking — even on slower terminals (WSL / Windows Terminal). Configurable **max render rate**.

## Requirements
- **Node.js ≥ 18**
- A shell where **ROS works** (`rostopic`/`rospy` for ROS1, or `ros2` for ROS2) — i.e. run it after `source`-ing your ROS setup. RDash inherits that environment; it knows nothing about how ROS is deployed (native, Docker, …).
- **Python plot deps** (`numpy` / `matplotlib` / `PyYAML`, see `requirements.txt`): **auto-installed on first run** if missing (the install log shows, then press Enter to start). Opt out with `RDASH_NO_AUTOPIP=1` and install manually with `pip install -r requirements.txt`.
- **Per-feature (optional):**
  - Plotting (`p`): the Python deps above, plus a display for the window.
  - rosbag (`R`/`P`): `ros2 bag` / `rosbag` on `PATH`.
  - Bandwidth / resource monitor: standard `ros2 topic bw` / `rostopic bw`, `ps`, `/proc`.

## Install
```bash
npm install
```

## Usage
Run it in a ROS-sourced shell:
```bash
# ROS1
source /opt/ros/noetic/setup.bash
node index.js

# ROS2
source /opt/ros/humble/setup.bash
node index.js
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
| `c` / `t` / `T` / `S` | connections (pub/sub) / TF tree / tf echo (two frames) / node resource monitor |
| `R` / `P` / `B` | rosbag record toggle / play (path) / A·B compare |
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

### Files
- `requirements.txt` — Python plot deps (auto-installed on first run).
- `~/.rdashrc` — saved command bookmarks (JSON).
- `~/.rdash_preflight.json` — preflight check definitions, e.g. `{"checks":[{"type":"topic","name":"/livox/imu","minHz":150},{"type":"node","name":"/fast_lio_mapping"}]}`.
- `rdash_rec_<ts>` — rosbag output directories created by `R`.

## Testing
Provide some ROS data, then run RDash in another shell.
```bash
# ROS1 (needs a display for turtlesim)
bash test/test_turtlesim.sh

# ROS2 (turtlesim if X11 available, else headless demo nodes)
bash test/test_ros2.sh
```

## Notes
- ROS2 params are per-node (no global param server), so a `params/` category only appears on ROS1.
- ROS2 CLI graph queries use a background daemon; if the tree is empty, run `ros2 daemon stop && ros2 daemon start`.

## License
MIT
