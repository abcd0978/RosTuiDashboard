# TODO: rosbridge/Web 분리 상태

2026-07-13. 현재 방향은 **TUI(`node index.js`)는 ROS CLI를 사용**하고, 동반 실행되는
**Web(`backend/telemetry.js`)은 rosbridge를 띄워 사용**하는 구조다.

- TUI 기본값: `RDASH_TUI_BACKEND=cli`
- Web 기본값: `RDASH_BACKEND=rosbridge`로 자식 프로세스 실행
- 개별 override: `RDASH_TUI_BACKEND`, `RDASH_WEB_BACKEND`

아래 내용은 나중에 TUI까지 rosbridge로 옮길 때 필요한 보류 작업 노트다. 당장은 적용하지 않는다.

## 왜 지금 TUI 는 rosbridge 를 못 쓰나

- `frontend/tui/store.js` 는 모든 ROS 동작을 **명령 문자열 → `spawnJob`/`runOnce`** 로 실행한다
  (`be.publish(...)` 가 반환하는 `rostopic pub -1 ...` 같은 문자열을 자식 프로세스로 띄움).
- `RDASH_BACKEND=rosbridge` 로 바꿔도 `RosbridgeBackend`(shared/backend.js)는 `CliBackend` 를 상속해
  `publish()` 가 **여전히 CLI 문자열**을 뱉는다 → TUI 는 rosbridge 로 안 감.
- 실제 rosbridge 클라이언트 연동(`RosbridgeClient` 사용: advertise/publish/subscribe/call_service)은
  **`backend/telemetry.js` 에만** 있다(`rbEnsure`/`rbEcho`/`rbTelemetryCore`/`rbPublish`). TUI 에는 없다.

## 무엇을 해야 하나

TUI 의 ROS 동작을 `be.kind === 'rosbridge'` 일 때 CLI 대신 `RosbridgeClient`(shared/rosbridge.js)
로 라우팅. 즉 server.js 가 이미 가진 rosbridge 분기를 TUI(store.js)에도 대응시키는 작업.

- **연결**: store 기동 시 `be.kind==='rosbridge'` 면 `new RosbridgeClient(be.url).connect()` 하나
  들고 다니기(웹서버의 `rbEnsure` 와 동일).
- **텔레메트리/그래프**: 현재 `python3 - telemetry.py` 스트림 → rosbridge 면 `/rosapi/topics`
  `/rosapi/nodes` + `subscribe` 로 Hz 카운트(backend/telemetry.js `rbTelemetryCore` 이식).
- **echo(값 패널)**: `rostopic echo` 스트림 → `rb.subscribe(topic, type, cb)` + `msgToYaml`.
- **publish (`x` on 토픽 / PublishForm)**: `spawnJob(rostopic pub)` → `rb.publish(topic, type, looseJson(msg))`.
- **service call (`x` on 서비스)**: → `rb.call(name, args)`.
- **param get/set, connections, tf, msgdef**: `/rosapi/*` 서비스로 대체(원격이면 CLI 불가).
- **teleop**: backend/telemetry.js 처럼 `rb.publish` 를 10Hz `setInterval` 로(재spawn 없이).
- **로컬 전용 기능**(node 리소스 CPU/RSS, rosbag 녹화/재생, 프로세스킬 등)은 원격 rosbridge 에선
  의미가 없으니 rosbridge 모드에서 비활성/미지원 처리(`RosbridgeBackend` 주석 참고).

## 참고 / 재사용 포인트

- `backend/telemetry.js` 의 rosbridge 분기 전부가 이식 템플릿이다(같은 `RosbridgeClient` API).
- `shared/rosbridge.js`: `subscribe`/`call`/`publish`(publish 는 최초 1회 auto-advertise).
- `RosbridgeBackend.url` = `RDASH_ROSBRIDGE_URL` 또는 `ws://localhost:9090`.
- 대안(더 작은 범위): TUI·웹이 **같은 rosbridge 하나**에 붙으면 백엔드가 통일된다. 이 경우에는
  `RDASH_TUI_BACKEND=rosbridge`를 별도로 켜고, 웹이 이미 띄워둔 rosbridge(9090)를 공유하게 한다.

## 검증

- 현재 목표 검증: `node index.js` 실행 시 TUI 는 CLI 명령을 사용하고, 동반 웹 서버는
  `RDASH_BACKEND=rosbridge` 환경으로 실행되어 rosbridge를 자동 기동/사용하는지 확인.
- 나중에 TUI rosbridge 이식 검증: `RDASH_TUI_BACKEND=rosbridge node index.js` → 트리/echo/publish/teleop 이
  CLI 모드와 동일하게 동작하고, publish/teleop 지연이 CLI(~수초 재spawn) 대비 즉시(≈0.2ms)인지 확인.
