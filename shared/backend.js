// Backend — ROS 조작을 셸 명령 문자열로 만들어 주는 빌더 파사드(spawn 은 호출측이 한다).
//
// 그래프·echo·publish·service·teleop 은 여기 없다 — 전부 rosbridge websocket 으로 처리한다
// (backend/telemetry.js, backend/jobs.js). 여기 남은 건 rosapi 로는 할 수 없어서 백엔드 호스트의
// ROS CLI/파이썬으로 해야 하는 것들뿐이다: 대역폭, 메시지 정의, 파라미터, rosbag, TF, 리소스, 브리지.
//
// 예전엔 CliBackend / RclNodeBackend / RosbridgeBackend 를 RDASH_BACKEND 로 갈아끼웠지만,
// /events 와 /echo 가 rosbridge 전용이 되면서 cli·rcl 은 켜도 아무것도 안 나오는 죽은 옵션이 됐다.
// 지금은 rosbridge 하나뿐이고, rosbridge_suite 가 필수다(없으면 backend/ros.js 가 띄운다).
import { actionFor, restartFor, protoCmd, bwCmd, splitNodeParam } from './ros.js';
import { IMG_BRIDGE, CLOUD_BRIDGE, BAG_DUMP, MARKER_BRIDGE, TF_DUMP, IMG_ANN_BRIDGE, CAMINFO_BRIDGE, GEOM_BRIDGE, URDF_BRIDGE, IM_BRIDGE } from './paths.js';
import {
  resourceCmd, tfTreeCmd, tfEchoCmd, bagRecordCmd, bagPlayCmd, bagCompareCmd,
  msgDefCmd, paramListCmd, paramGetCmd, paramSetCmd,
} from './commands.js';
import { shq } from './util.js';

export class Backend {
  constructor(ver) { this.ver = ver; }
  get kind() { return 'rosbridge'; }
  get url() { return process.env.RDASH_ROSBRIDGE_URL || 'ws://localhost:9090'; }

  // rosapi 로는 못 하는 것들 — 백엔드 호스트의 ROS CLI 로.
  bandwidth(topic) { return bwCmd(this.ver, topic); }   // 메시지 바이트 크기를 rosapi 가 모른다
  rosout() { return this.ver === '2' ? 'stdbuf -oL ros2 topic echo /rosout 2>/dev/null' : 'stdbuf -oL rostopic echo /rosout 2>/dev/null'; }
  diagnostics() { return this.ver === '2' ? 'stdbuf -oL ros2 topic echo /diagnostics 2>/dev/null' : 'stdbuf -oL rostopic echo /diagnostics 2>/dev/null'; }
  msgDef(ty) { return msgDefCmd(this.ver, ty); }
  proto(kind, name, ty) { return protoCmd(this.ver, kind, name, ty); }   // kind: 'topic'|'service' — 호출측이 지정
  resource(nodes) { return resourceCmd(nodes); }
  tfTree() { return tfTreeCmd(this.ver); }
  tfEcho(src, tgt) { return tfEchoCmd(this.ver, src, tgt); }
  bagCompare(a, b) { return bagCompareCmd(this.ver, a, b); }
  bagRecord(topics, out) { return bagRecordCmd(this.ver, topics, out); }
  bagPlay(path) { return bagPlayCmd(this.ver, path); }
  paramList(node) { return paramListCmd(node); }
  paramGet(node, name) { return paramGetCmd(node, name); }
  // 파라미터 단일 값 — 이름 형식이 버전마다 다르다(splitNodeParam 주석 참조).
  //   ROS1: rosparam get /common/imu_topic
  //   ROS2: /turtlesim:background_r → ros2 param get /turtlesim background_r
  paramGet1(name) {
    if (this.ver !== '2') return `rosparam get ${shq(name)} 2>&1`;
    const [nd, p] = splitNodeParam(name);
    return p ? `ros2 param get ${shq(nd)} ${shq(p)} 2>&1 | sed -n 's/.*value is: //p'` : null;
  }
  paramSet(node, name, val) { return paramSetCmd(node, name, val); }
  setParam1(name, val) { const a = actionFor(this.ver, 'param', name, val); return a && a.cmd; }
  killNode(name) { const a = actionFor(this.ver, 'node', name); return a && a.cmd; }
  restartNode(name) { const a = restartFor('node', name); return a && a.cmd; }
  lifecycle(node, transition) { return `ros2 lifecycle set ${shq(node)} ${transition} 2>&1`; }
  actionGoal(name, type, goal) { return `ros2 action send_goal ${shq(name)} ${shq(type)} ${shq(goal)} --feedback 2>&1`; }

  // 센서/3D 브리지 — 각 경로는 shared/paths.js 가 유일한 창구, env 로 개별 오버라이드 가능.
  imgBridge(topic) { return `python3 ${shq(process.env.RDASH_IMG_BRIDGE || IMG_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  cloudBridge(topic) { return `python3 ${shq(process.env.RDASH_CLOUD_BRIDGE || CLOUD_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  bagDump(path, topics) { return `python3 ${shq(process.env.RDASH_BAG_DUMP || BAG_DUMP)} ${shq(path)} ${shq(topics || '')} 2>/dev/null`; }
  markerBridge(topic) { return `python3 ${shq(process.env.RDASH_MARKER_BRIDGE || MARKER_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  tfDump() { return `python3 ${shq(process.env.RDASH_TF_DUMP || TF_DUMP)} 2>/dev/null`; }
  imgAnnBridge(topic) { return `python3 ${shq(process.env.RDASH_IMG_ANN_BRIDGE || IMG_ANN_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  camInfoBridge(topic) { return `python3 ${shq(process.env.RDASH_CAMINFO_BRIDGE || CAMINFO_BRIDGE)} ${shq(topic)} 2>/dev/null`; }
  geomBridge(topic, ty) { return `python3 ${shq(process.env.RDASH_GEOM_BRIDGE || GEOM_BRIDGE)} ${shq(topic)} ${shq(ty || '')} 2>/dev/null`; }
  urdfBridge() { return `python3 ${shq(process.env.RDASH_URDF_BRIDGE || URDF_BRIDGE)} ${shq(process.env.RDASH_URDF_FILE || 'topic')} 2>/dev/null`; }
  imBridge(topic) { return `python3 ${shq(process.env.RDASH_IM_BRIDGE || IM_BRIDGE)} ${shq(topic)}`; }
}

export function makeBackend(ver) { return new Backend(ver); }
