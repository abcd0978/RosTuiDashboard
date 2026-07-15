// ROS 버전별 기본 포트 — 이 파일이 유일한 창구다.
//
// superpx4(ROS1/noetic)와 superpx4_ros2(ROS2/humble)는 같은 RosTuiDashboard 볼륨을 공유하고,
// 둘 다 --network host 로 뜬다(PX4 uXRCE-DDS 8888 을 공유해야 해서 필수). 그래서 localhost 를
// 공유한다 — 두 컨테이너에서 RDash 를 동시에 띄우면 웹 포트와 rosbridge 포트가 부딪힌다.
// 실제로 ROS2 rosbridge 가 9090 을 먼저 잡으면 ROS1 RDash 가 옆 컨테이너 브리지에 붙어
// 자기 그래프를 못 봤다(turtle 이 트리에 안 잡히던 버그).
//
// 버전마다 포트를 갈라 자동으로 안 부딪히게 한다. env(RDASH_WEB_PORT·RDASH_ROSBRIDGE_URL)가
// 있으면 그게 우선 — 다른 배치가 필요하면 그걸로 덮는다.
const DEFAULTS = {
  '1': { webPort: 8080, rosbridgeUrl: 'ws://localhost:9090' },
  '2': { webPort: 8082, rosbridgeUrl: 'ws://localhost:9091' },
};
const pick = (ver) => DEFAULTS[ver === '2' ? '2' : '1'];

export const webPort = (ver) => Number(process.env.RDASH_WEB_PORT) || pick(ver).webPort;
export const rosbridgeUrl = (ver) => process.env.RDASH_ROSBRIDGE_URL || pick(ver).rosbridgeUrl;
