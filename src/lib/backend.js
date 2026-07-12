// RosBackend — ROS 조작을 UI 에서 분리하는 백엔드 인터페이스.
// 목적: UI/서버 코드는 이 인터페이스만 호출하고, 구현체를 갈아끼우면(CLI → rclnodejs → rosbridge)
//       UI 를 안 고치고 데이터 소스를 바꿀 수 있다. (리뷰 제안: UI ↓ RosBackend ├CliBackend ├RclNode ├Rosbridge)
// 현행 CliBackend 는 기존 commands.js/ros.js 빌더를 감싸는 파사드 — 셸 명령 문자열을 만든다(spawn 은 호출측).
import { echoFullCmd, actionFor, restartFor, protoCmd } from './ros.js';
import { TELEM, TELEM2, IMG_BRIDGE, CLOUD_BRIDGE, BAG_DUMP, ECHO_MUX, MARKER_BRIDGE, TF_DUMP } from './paths.js';
import {
  connectionsCmd, resourceCmd, tfTreeCmd, tfEchoCmd, bagRecordCmd, bagPlayCmd, bagCompareCmd,
  msgDefCmd, paramListCmd, paramGetCmd, paramSetCmd,
} from './commands.js';
import { shq } from './util.js';

const NI = (n) => { throw new Error(`RosBackend.${n}: 미구현(구현체에서 오버라이드)`); };

// 계약(인터페이스) — 모든 ROS 조작의 단일 목록. 구현체가 채운다.
export class RosBackend {
  constructor(ver) { this.ver = ver; }
  telemetryScript() { return NI('telemetryScript'); }   // 그래프 스트림(노드/토픽/QoS/Hz)
  echo() { return NI('echo'); } rosout() { return NI('rosout'); } diagnostics() { return NI('diagnostics'); }
  msgDef() { return NI('msgDef'); } proto() { return NI('proto'); } connections() { return NI('connections'); }
  resource() { return NI('resource'); } tfTree() { return NI('tfTree'); } tfEcho() { return NI('tfEcho'); }
  bagCompare() { return NI('bagCompare'); } bagRecord() { return NI('bagRecord'); } bagPlay() { return NI('bagPlay'); }
  paramList() { return NI('paramList'); } paramGet() { return NI('paramGet'); } paramSet() { return NI('paramSet'); }
  publish() { return NI('publish'); } serviceCall() { return NI('serviceCall'); } setParam1() { return NI('setParam1'); }
  killNode() { return NI('killNode'); } restartNode() { return NI('restartNode'); } lifecycle() { return NI('lifecycle'); }
  actionGoal() { return NI('actionGoal'); } teleop() { return NI('teleop'); }
  imgBridge() { return NI('imgBridge'); } cloudBridge() { return NI('cloudBridge'); } bagDump() { return NI('bagDump'); }
}

// CliBackend — 현행 구현. ros2/rostopic CLI 명령 문자열 생성(ROS1/ROS2 자동 분기).
export class CliBackend extends RosBackend {
  get kind() { return 'cli'; }
  telemetryScript() { return this.ver === '2' ? TELEM2 : TELEM; }
  echo(topic) { return echoFullCmd(this.ver, topic); }
  rosout() { return this.ver === '2' ? 'stdbuf -oL ros2 topic echo /rosout 2>/dev/null' : 'stdbuf -oL rostopic echo /rosout 2>/dev/null'; }
  diagnostics() { return this.ver === '2' ? 'stdbuf -oL ros2 topic echo /diagnostics 2>/dev/null' : 'stdbuf -oL rostopic echo /diagnostics 2>/dev/null'; }
  msgDef(ty) { return msgDefCmd(this.ver, ty); }
  proto(topic, ty) { return protoCmd(this.ver, 'topic', topic, ty); }
  connections(kind, name) { return connectionsCmd(this.ver, kind, name); }
  resource(nodes) { return resourceCmd(nodes); }
  tfTree() { return tfTreeCmd(this.ver); }
  tfEcho(src, tgt) { return tfEchoCmd(this.ver, src, tgt); }
  bagCompare(a, b) { return bagCompareCmd(this.ver, a, b); }
  bagRecord(topics, out) { return bagRecordCmd(this.ver, topics, out); }
  bagPlay(path) { return bagPlayCmd(this.ver, path); }
  paramList(node) { return paramListCmd(node); }
  paramGet(node, name) { return paramGetCmd(node, name); }
  paramSet(node, name, val) { return paramSetCmd(node, name, val); }
  publish(topic, msg) { const a = actionFor(this.ver, 'topic', topic, msg); return a && a.cmd; }
  serviceCall(name, req) { const a = actionFor(this.ver, 'service', name, req); return a && a.cmd; }
  setParam1(name, val) { const a = actionFor(this.ver, 'param', name, val); return a && a.cmd; }
  killNode(name) { const a = actionFor(this.ver, 'node', name); return a && a.cmd; }
  restartNode(name) { const a = restartFor('node', name); return a && a.cmd; }
  lifecycle(node, transition) { return `ros2 lifecycle set ${shq(node)} ${transition} 2>&1`; }
  actionGoal(name, type, goal) { return `ros2 action send_goal ${shq(name)} ${shq(type)} ${shq(goal)} --feedback 2>&1`; }
  teleop(topic, lin, ang) { const y = `{linear: {x: ${lin}, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: ${ang}}}`; return this.ver === '2' ? `ros2 topic pub -r 10 ${shq(topic)} geometry_msgs/msg/Twist ${shq(y)}` : `rostopic pub -r 10 ${shq(topic)} geometry_msgs/Twist ${shq(y)}`; }
  imgBridge(topic) { return `python3 ${shq(process.env.RDASH_IMG_BRIDGE || IMG_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  cloudBridge(topic) { return `python3 ${shq(process.env.RDASH_CLOUD_BRIDGE || CLOUD_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  bagDump(path, topics) { return `python3 ${shq(process.env.RDASH_BAG_DUMP || BAG_DUMP)} ${shq(path)} ${shq(topics || '')} 2>/dev/null`; }
  markerBridge(topic) { return `python3 ${shq(process.env.RDASH_MARKER_BRIDGE || MARKER_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  tfDump() { return `python3 ${shq(process.env.RDASH_TF_DUMP || TF_DUMP)} 2>/dev/null`; }
  // echo 멀티플렉서 명령. CLI 백엔드는 기본적으로 안 씀(usesMux=false)지만, RDASH_ECHO_MUX 로 켜서 테스트 가능.
  get usesMux() { return !!process.env.RDASH_ECHO_MUX; }
  echoMux() { return `python3 ${shq(process.env.RDASH_ECHO_MUX || ECHO_MUX)} ${this.ver}`; }
}

// RclNodeBackend — 단일 rclpy 노드 전략. 액션(publish/service/param 등)은 CliBackend 를 그대로 상속하지만,
// 고빈도 스트림(echo/rosout/diagnostics)은 프로세스 1개짜리 멀티플렉서(ros_echo_mux.py)로 팬아웃한다.
// → 토픽마다 `ros2 topic echo` 를 띄우던 프로세스 폭증을 없앤다. (텔레메트리는 telemetry_ros2.py 가 이미 단일 노드)
// 참고: 원 제안의 rclnodejs 대신 rclpy 를 쓴다 — 네이티브 npm 빌드 의존성이 없고, 코드베이스(telemetry)와 일관되며,
//       서버측 멀티플렉싱을 mock 으로 검증 가능하기 때문. rosbridge 연결은 향후 RosbridgeBackend 로.
export class RclNodeBackend extends CliBackend {
  get kind() { return 'rcl'; }
  get usesMux() { return true; }
}

// RosbridgeBackend — 원격 로봇의 rosbridge_suite(websocket)에 붙는 백엔드. 로컬 ROS 설치 불필요.
// 스트림(events/echo)·그래프·publish/service 는 서버가 RosbridgeClient 로 처리(server.js 의 rosbridge 분기).
// 로컬 전용 기능(node 리소스·rosbag 녹화 등)은 원격에선 의미가 없어 미지원 처리.
export class RosbridgeBackend extends CliBackend {
  get kind() { return 'rosbridge'; }
  get url() { return process.env.RDASH_ROSBRIDGE_URL || 'ws://localhost:9090'; }
}

// 팩토리 — RDASH_BACKEND(cli|rcl|rosbridge) 로 선택.
export function makeBackend(ver, kind = process.env.RDASH_BACKEND || 'cli') {
  switch (kind) {
    case 'rcl': return new RclNodeBackend(ver);
    case 'rosbridge': return new RosbridgeBackend(ver);
    case 'cli': return new CliBackend(ver);
    default: return new CliBackend(ver);
  }
}
