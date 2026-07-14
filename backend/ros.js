// ROS 백엔드 선택 · ROS1/ROS2 감지 · rosbridge_server 자동 기동/유지 · ROS 정리 스크립트.
import { spawn, spawnSync } from 'child_process';
import { makeBackend } from '../shared/backend.js';

function detectVer() {
  if (process.env.ROS_VER) return process.env.ROS_VER;
  const r = spawnSync('bash', ['-lc', 'command -v ros2 >/dev/null 2>&1']);
  return r.status === 0 ? '2' : '1';
}
export const VER = detectVer();
// 웹은 항상 rosbridge 백엔드만 사용한다. rosbridge 미연결 시 CLI 로 폴백하지 않는다.
export const BACKEND = 'rosbridge';
export const be = makeBackend(VER, BACKEND);

// rosbridge_server 자동 기동/유지(launch = websocket + rosapi). 로컬 URL 한정. ROS1 은 마스터 뜬 뒤에만.
export function tcpOpen(port) {
  try {
    return (spawnSync('bash', ['-c', `(exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo up`]).stdout || '').toString().includes('up');
  } catch {
    return false;
  }
}
let rbProc = null;
function ensureRosbridge() {
  if (BACKEND !== 'rosbridge' || !/localhost|127\.0\.0\.1/.test(be.url)) return;
  if (tcpOpen(9090)) return;                        // 이미 떠 있음(공유)
  if (rbProc && rbProc.exitCode === null) return;   // 기동 중
  if (VER !== '2' && !tcpOpen(11311)) return;       // ROS1: 마스터 없으면 대기(경쟁 마스터 방지)
  const cmd = VER === '2' ? 'ros2 launch rosbridge_server rosbridge_websocket_launch.xml'
                          : 'roslaunch rosbridge_server rosbridge_websocket.launch';
  const ros1Net = VER === '2' ? '' : 'unset ROS_HOSTNAME; export ROS_IP=${ROS_IP:-127.0.0.1}; ';
  rbProc = spawn('bash', ['-lc', `${ros1Net}source /opt/ros/*/setup.bash 2>/dev/null; exec ${cmd}`], { stdio: 'ignore' });
  rbProc.on('error', () => { rbProc = null; });
  rbProc.on('exit', () => { rbProc = null; });
}
ensureRosbridge();
setInterval(ensureRosbridge, 5000);
const killRb = () => { try { if (rbProc) rbProc.kill('SIGINT'); } catch { /* */ } };
process.on('exit', killRb);
process.on('SIGINT', killRb);
process.on('SIGTERM', killRb);

export function cleanRosCmd() {
  return String.raw`source /opt/ros/noetic/setup.bash 2>/dev/null || true
set +e
echo "[1/4] kill ROS nodes (keep rdash/rosbridge/rosapi/rosout)"
rosnode list 2>/dev/null | grep -Ev '^/(rosout|rosapi|rosbridge_websocket|ros_tui|rostopic)(_|$|/)?' | while read -r n; do
  [ -z "$n" ] && continue
  echo "rosnode kill $n"
  timeout 5 rosnode kill "$n" 2>&1 || true
done
echo "[2/4] kill app/sim process groups"
ps -eo pid,ppid,pgid,cmd | grep -Ei 'px4|fast.?lio|laserMapping|super_px4|gazebo|gzserver|mavros|turtlesim' | grep -v grep > /tmp/rdash_clean_matches.txt || true
cat /tmp/rdash_clean_matches.txt
PGIDS=$(awk '{print $3}' /tmp/rdash_clean_matches.txt | sort -u)
for g in $PGIDS; do echo "SIGINT -$g"; kill -INT -"$g" 2>/dev/null || true; done
sleep 3
ps -eo pid,ppid,pgid,cmd | grep -Ei 'px4|fast.?lio|laserMapping|super_px4|gazebo|gzserver|mavros|turtlesim' | grep -v grep > /tmp/rdash_clean_left.txt || true
if [ -s /tmp/rdash_clean_left.txt ]; then
  echo "[3/4] force kill remaining"
  cat /tmp/rdash_clean_left.txt
  LEFTPG=$(awk '{print $3}' /tmp/rdash_clean_left.txt | sort -u)
  for g in $LEFTPG; do echo "SIGKILL -$g"; kill -KILL -"$g" 2>/dev/null || true; done
  sleep 1
else
  echo "[3/4] no remaining app/sim process"
fi
echo "[4/4] cleanup ROS master stale registrations"
yes y | rosnode cleanup 2>&1 || true
echo "--- remaining ROS nodes ---"
rosnode list 2>/dev/null | sort || true
echo "--- remaining app/sim processes ---"
ps -eo pid,ppid,pgid,stat,cmd | grep -Ei 'px4|fast.?lio|laserMapping|super_px4|gazebo|gzserver|mavros|turtlesim' | grep -v grep || true`;
}
