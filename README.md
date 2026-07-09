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
 ↑↓ move | Enter select | wheel: L=tree R=value | [ ] value | q quit
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
- **Plotting** (`p` on a topic): opens a native **matplotlib** window fed by the topic's echo stream. General-purpose — works on any numeric field(s):
  - **time** mode: raw value + **n-th derivative / integral** (`↑`/`↓` in the window; e.g. velocity→acceleration) + **FFT** spectrum. Multiple fields overlay on one time axis.
  - **xy** mode (2 fields): parametric/correlation plot with equal aspect (a circular trajectory shows as a circle) + **linear regression** line & R² (toggle with `f`).
  - **xyz** mode (3 fields): 3D trajectory.
  - Pick fields in the picker: `space` to multi-select, `Enter` for time, `x` for spatial (2=XY, 3=3D). Requires `python3` with `numpy`/`matplotlib` and a display.
- **Control actions** (`x` on a selection): kill node (ROS1 `rosnode kill`; ROS2 SIGINT by node→PID, best-effort), call service, set param — the rqt-style *control* half.
- **ROS1 & ROS2 auto-detected** from the environment.
- **Keyboard + mouse** (click to select/expand, wheel to scroll, hover on buttons).
- Configurable **max render rate** (fast topics don't flood the screen).

## Requirements
- **Node.js ≥ 18**
- A shell where **ROS works** (`rostopic`/`rospy` for ROS1, or `ros2` for ROS2) — i.e. run it after `source`-ing your ROS setup. RDash inherits that environment; it knows nothing about how ROS is deployed (native, Docker, …).

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
| `p` | plot the selected topic (matplotlib: raw / n-th d·∫ / FFT / XY+regression / 3D) |
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
