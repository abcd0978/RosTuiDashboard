# RDash Backend API

The contract between `backend/` and its clients. **Both** front ends speak only this
API — `frontend/web/` (browser) and `frontend/tui/` (React Ink). Neither one talks to
ROS directly, and neither one needs to know whether the backend reaches ROS through
the CLI, a single rclpy node, or a remote rosbridge (`RDASH_BACKEND=cli|rcl|rosbridge`).

Base URL: `http://localhost:${RDASH_WEB_PORT || 8080}` (bind address `RDASH_WEB_HOST`,
default `0.0.0.0`).

---

## 1. Conventions

- **JSON in, JSON out.** POST bodies are JSON; every JSON response is an object.
- **Query params** are URL query string; **body params** are JSON POST bodies.
  A route is GET unless the table says POST.
- **Shell-ish results** come back as `{ "out": "<text>" }` — the raw text a human
  would have seen in a terminal. Render it as-is; do not try to parse it unless a
  route says otherwise.
- **Errors:**
  - `400 {"error":"topic"}` — a required query param is missing.
  - `503 {"error":"rosbridge unavailable: <url>"}` — the route needs the rosbridge
    connection and it is not up. Marked **[RB]** below. Treat as "temporarily
    unavailable": show the message, keep the UI alive, retry later. The backend
    reconnects on its own.
  - `500 {"error":"<message>"}` — unexpected server error.
  - `404` — unknown path.
- **No auth, no CSRF, no rate limit.** It is a localhost dev tool.

---

## 2. The graph snapshot (`items`)

The single most important structure. `/events` pushes one per second; `/api/graph`
returns one on demand. It is a **complete snapshot** — replace your whole item list
with it, do not merge.

```jsonc
{
  "items": [
    { "p": "topics/scan", "kind": "topic",   "name": "/scan",
      "ty": "sensor_msgs/LaserScan",
      "hz": 9.8,          // number, or null = NOT MEASURED (see below). NOT the same as 0.
      "age": 0.10,        // seconds since last message; null if unmeasured / never seen
      "pubs": [["/lidar", null, null]],   // [nodeName, reliability, durability]
      "subs": [["/slam",  null, null]] }, // ROS1 has no QoS → the two extra slots are null
    { "p": "services/reset", "kind": "service", "name": "/reset", "server": [] },
    { "p": "nodes/slam",     "kind": "node",    "name": "/slam" },
    { "p": "params/rate",    "kind": "param",   "name": "/rate" }   // ROS1 only
  ]
}
```

- `kind` ∈ `topic | service | node | param`.
- `p` is a tree path (`"<category>" + name`) — use it to build the namespace tree.
- **`hz: null` means "not measured", NOT "0 Hz".** Doing `hz || 0` will make every
  unmeasured topic look dead. Render null as blank/`—`. Same for `age`.
- Instead of `{items:[...]}` a tick may be `{"nomaster": true}` — the backend has no
  ROS connection right now. Do **not** clear your item list on this; keep showing
  what you have and mark the connection as down. When the connection returns, normal
  snapshots resume by themselves.

### Which topics get an `hz`

Measuring Hz costs the backend a live subscription per topic, so it only measures the
topics a client **asks** for. Tell it what is currently on screen:

`POST /api/measure` `{ "topics": ["/scan", "/odom"] }` → `{ "ok": true }`

- The set is **replaced**, not merged. Send the full list every time it changes.
- It is **global**, not per-client: the last POST wins. (With one TUI and one browser
  connected they will fight; that is a known limitation, not something to work around.)
- The backend clears it when the last stream client disconnects.
- Debounce it (~300 ms) and only send when the set actually changed.

---

## 3. Streams

Two transports carry the same data. **Prefer the WebSocket multiplex** — it is one
connection for every stream instead of one per stream.

### 3a. WebSocket multiplex — `ws://<host>/ws`

Client → server (JSON text frames):

```jsonc
{ "op": "sub",   "id": 7, "stream": "echo", "params": { "topic": "/odom" } }
{ "op": "unsub", "id": 7 }
{ "op": "feed",  "id": 7, "data": { ... } }   // stream → child process stdin (imstream only)
```
`id` is a client-chosen integer, unique per connection.

Server → client:
- **Text frame** `{"i": 7, "d": "<one line of payload>"}` — `d` is a string.
- **Binary frame** (only `cloudstream`): `[uint32 LE id][uint32 LE mode][float32 xyzc…]`.
  Read the id from the first 4 bytes to route it.

`stream` values:

| stream | params | payload of each `d` |
|---|---|---|
| `events` | — | a JSON string: the graph snapshot of §2 **[RB]** |
| `echo` | `topic` | a JSON string: the message rendered as YAML-ish text **[RB]** |
| `rosout` | — | one `/rosout` message block (text) |
| `diagnostics` | — | one DiagnosticArray block (text) |
| `bw` | `topic` | one line of `rostopic bw` output (`average: 2.00KB/s`, …) |
| `imgstream` | `topic` | JSON line: base64 JPEG frame |
| `cloudstream` | `topic` | *binary frames* (PointCloud2 xyz) |
| `markerstream` | `topic` | JSON line: visualization_msgs Marker(Array) |
| `geomstream` | `topic`, `type` | JSON line: LaserScan/Path/Odometry/Pose*/OccupancyGrid → markers |
| `tfstream` | — | JSON line: TF frame transforms |
| `urdfstream` | — | JSON line: URDF link visuals |
| `annstream` | `topic` | JSON line: detections/annotations |
| `caminfostream` | `topic` | JSON line: CameraInfo |
| `imstream` | `topic` | JSON line: InteractiveMarker (bidirectional — use `feed`) |

If a **[RB]** stream is requested while rosbridge is down, the server sends one
`{"error":"rosbridge unavailable: <url>"}` on that id instead of data.

Closing the socket tears down every child process it started. Always `unsub` streams
you no longer need — each one is a live ROS subscription or a child process.

### 3b. Server-Sent Events (same data, one connection each)

`text/event-stream`, each message framed as `data: <payload>\n\n`.

| path | payload |
|---|---|
| `GET /events` | graph snapshot JSON **[RB]** |
| `GET /echo?topic=/x` | message text **[RB]** |
| `GET /rosout` | log block **[RB]** |
| `GET /diagnostics` | diagnostics block **[RB]** |
| `GET /api/bw?topic=/x` | one line of bandwidth output per message |
| `GET /imgstream?topic=` | base64 JPEG JSON lines |
| `GET /markerstream?topic=` | marker JSON lines |
| `GET /geomstream?topic=&type=` | marker JSON lines |
| `GET /tfstream` | TF JSON lines |
| `GET /urdfstream` | URDF JSON lines |
| `GET /annstream?topic=` | annotation JSON lines |
| `GET /caminfostream?topic=` | CameraInfo JSON lines |

`cloudstream` is **WebSocket-only** (binary); there is no SSE version.

---

## 4. Queries (GET)

| path | params | response |
|---|---|---|
| `/api/ver` | — | `{"ver":"1"\|"2"}` — the ROS major version the backend detected |
| `/api/graph` | — | one snapshot `{items:[…]}` **[RB]**; falls back to the last good snapshot on timeout |
| `/api/msgdef` | `type` | `{"out": "<message definition text>"}` |
| `/api/proto` | `name`, `type` | `{"yaml": "{linear: {x: 0}, …}"}` — a one-line flow-YAML skeleton to prefill a publish form. Always returns something (`"{}"` if it can't build one). |
| `/api/connections` | `kind`=`topic`\|`service`\|`node`, `name` | `{"out": "<text>"}` **[RB]** — `topic`: type + publishers + subscribers (this is what `rostopic info` shows). `service`: type + providers. `node`: node details JSON. |
| `/api/tftree` | — | `{"out": "<frame tree text>"}` |
| `/api/tfecho` | `src`, `tgt` | `{"out": "<transform text>"}` |
| `/api/param/list` | `node` | `{"rows":[{"name":"/p","value":"1.0"}, …]}` |
| `/api/param/get1` | `name` | `{"out":"<value>"}` (ROS1). On ROS2 returns an explanatory string — params are per-node, use `/api/param/list`. |
| `/api/bagdump` | `path`, `topics` | `{"series":{…}}` — numeric leaf time-series from a bag; on failure `{"series":{}, "error":"…"}` |
| `/api/bagcompare` | `a`, `b` | `{"out":"<side-by-side bag info>"}` |
| `/api/preflight` | — | `{"checks":[…]}` from `~/.rdash_preflight.json` |
| `/api/jobs` | — | `{"jobs":[Job, …]}` (see §6) |
| `/api/baseline` | — | `{"baseline": <profile>\|null}` |
| `/api/bookmarks` | — | `{"bookmarks":[…], "preset":"<name>", "presets":["…"]}` |

`/api/resource` is **POST** (body `{"nodes":["/a","/b"]}`) → `{"out":"<CPU/RSS/threads table>"}`.

---

## 5. Actions (POST)

| path | body | response |
|---|---|---|
| `/api/publish` | `{name, msg}` — `msg` is flow-YAML **or** JSON text | `{"out":"published (rosbridge)"}` **[RB]** |
| `/api/service` | `{name, req}` — `req` is flow-YAML/JSON text | `{"out":"<response JSON>"}` or `{"out":"(no response)"}` **[RB]** |
| `/api/teleop` | `{topic?, lin, ang, ty?}` or `{topic?, stop:true}` | `{"ok":true}` **[RB]** |
| `/api/param/set` | `{node, name, value}` | `{"value":"<value read back after setting>"}` |
| `/api/setparam1` | `{name, value}` | `{"out":"…"}` — ROS1 global param |
| `/api/killnode` | `{name}` | `{"out":"…"}` |
| `/api/restart` | `{name}` | `{"out":"…"}` |
| `/api/lifecycle` | `{node, transition}` | `{"out":"…"}` — ROS2 lifecycle |
| `/api/clean-ros` | `{}` | `{"out":"…"}` — kill stray ROS nodes (keeps rdash/rosbridge/rosapi/rosout) |
| `/api/run` | `{cmd}` | `{"out":"<stdout+stderr>"}` — run an arbitrary shell command, wait for it, return output |
| `/api/measure` | `{topics:[…]}` | `{"ok":true}` — see §2 |
| `/api/baseline` | `{profile:{…}}` | `{"ok":true}` — the **client** computes the profile and the diff; the server only stores it |
| `/api/bookmarks` | `{bookmarks:[…]}` | `{"ok":true}` |
| `/api/preset` | `{name?}` — omit `name` to cycle to the next preset | `{"preset", "presets", "bookmarks"}` |

**Teleop is stateful**: one POST sets a persistent publisher that keeps sending at a
fixed rate until you POST `{stop:true}` for that topic. Do not poll it yourself.

**`/api/publish` and `/api/service` accept loose YAML**: `{linear: {x: 0.5}}` works —
keys do not need quoting. The backend also accepts strict JSON.

---

## 6. Jobs — long-running processes

A job is a child process the backend owns (rosbag record/play, an action goal, a
bookmarked command). It survives across clients, so the TUI and the browser see the
same job list.

```jsonc
{ "id": 3, "label": "rosbag rec → rdash_rec_1699…", "pid": 12345,
  "status": "run" | "done" | "error" | "stopping" | "killed",
  "log": ["last", "30", "lines", …] }
```

| path | body | response |
|---|---|---|
| `GET /api/jobs` | — | `{"jobs":[Job, …]}` |
| `POST /api/job` | `{cmd, label?}` | `Job` — run an arbitrary command as a job |
| `POST /api/action` | `{name, type, goal}` | `Job` — send an action goal; feedback arrives in the job log |
| `POST /api/record` | `{topics?: []}` | `Job` — rosbag record (all topics if `topics` is empty/absent) |
| `POST /api/play` | `{path}` | `Job` — rosbag play |
| `POST /api/job/<id>/kill` | — | `{"ok":true, "job": Job\|null}` |

There is no job stream — **poll `GET /api/jobs`** while a jobs view is open (1 s is
fine). `log` is capped at the last 30 lines in the view (400 retained server-side).

---

## 7. Static files

Any GET that matches nothing above is served from `frontend/web/`, with directory
traversal blocked. Irrelevant to the TUI.

---

## 8. Notes for a client implementer

- **The snapshot is the truth.** Build your tree/graph from `items` alone. Do not
  keep a parallel model of the ROS graph.
- **Nothing here blocks.** Every route returns quickly; long work becomes a Job.
- **`503` is normal during startup** — the backend spawns/attaches to rosbridge in the
  background. Show a "connecting" state, keep polling; it heals itself.
- **The backend can restart underneath you** (or rosbridge can). Reconnect the
  WebSocket with backoff and re-`sub` your streams; the server does not remember you.
- **Local-only features are still here**, even when the backend reaches ROS over a
  remote rosbridge: `/api/resource`, `/api/record`, `/api/play`, `/api/killnode`,
  `/api/restart`, `/api/run` all shell out on the machine the *backend* runs on. That
  is usually what you want (the backend runs next to the robot).
