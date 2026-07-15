// ROS 버전 감지 — 이 판정 하나가 포트·명령·파라미터 모델을 전부 가른다. 부작용 없음(감지만 한다).
//
// 백엔드(backend/ros.js)와 TUI 부트스트랩(index.js·frontend/tui/lib/api.js)이 둘 다 이 값을 봐야
// 같은 포트를 쓴다(shared/ports.js). backend/ros.js 를 직접 import 하면 rosbridge 워치독까지 딸려
// 오므로, 감지만 여기로 떼어 두 쪽이 안전하게 공유한다.
import { spawnSync } from 'child_process';

// 판정 순서 — 확실한 신호부터. 마지막의 파일시스템 폴백이 중요하다: 포트가 이 값에 걸려 있어서,
// setup.bash 를 source 안 한 셸에서 띄우면 ros2 가 PATH 에 없어 ROS2 컨테이너가 ROS1 로 오판하고
// ROS1 포트(8080/9090)를 골라 다시 충돌한다. 그래서 설치된 배포판까지 본다.
const ROS2_DISTROS = /\/(humble|foxy|galactic|iron|jazzy|rolling|kilted)\/?$/m;
function detectVer() {
  if (process.env.ROS_VER) return process.env.ROS_VER;            // 명시 오버라이드
  if (process.env.ROS_VERSION === '2') return '2';               // 소싱됨 — ROS 가 직접 알려준다
  if (process.env.ROS_VERSION === '1') return '1';
  if (spawnSync('bash', ['-lc', 'command -v ros2 >/dev/null 2>&1']).status === 0) return '2';   // PATH 에 ros2
  // 아직 안 소싱됐을 수 있다 — /opt/ros 에 뭐가 깔렸는지로 판정.
  const distros = String(spawnSync('bash', ['-lc', 'ls -d /opt/ros/*/ 2>/dev/null']).stdout || '');
  return ROS2_DISTROS.test(distros) ? '2' : '1';
}
export const VER = detectVer();
