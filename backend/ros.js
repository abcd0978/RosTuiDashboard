// ROS1/ROS2 감지 · rosbridge_server 자동 기동/유지 · ROS 정리 스크립트.
// ROS 그래프/echo 는 전적으로 rosbridge 를 통한다 — rosbridge_suite 가 필수다(없으면 여기서 띄운다).
import net from 'net';
import { spawn } from 'child_process';
import { makeBackend } from '../shared/backend.js';
import { VER } from '../shared/ver.js';

export { VER };   // 기존에 './ros.js' 에서 VER 을 받던 곳들 유지 — 감지 자체는 shared/ver.js 로 옮겼다
export const be = makeBackend(VER);

// rosbridge 포트는 URL 에서 뽑는다 — 박아 넣으면 RDASH_ROSBRIDGE_URL 을 바꿨을 때 엉뚱한 포트를 본다.
const RB_PORT = Number((be.url.match(/:(\d+)/) || [])[1]) || 9090;
const RB_LOCAL = /(\/\/|@)(localhost|127\.0\.0\.1)(:|\/|$)/.test(be.url);
const MASTER_PORT = Number((process.env.ROS_MASTER_URI || '').match(/:(\d+)/)?.[1]) || 11311;   // ROS1 전용

// 포트가 열려 있나 — net 으로 직접 찌른다.
// 예전엔 spawnSync('bash', '/dev/tcp/...') 였는데, 이건 동기 서브프로세스라 부를 때마다 이벤트 루프를 멈춘다.
// 5 초마다 도는 워치독에서 쓰기엔 너무 비싸다(게다가 bash 의존).
function tcpOpen(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, '127.0.0.1');
  });
}

// rosbridge_server 자동 기동/유지(launch = websocket + rosapi). 로컬 URL 한정.
// ROS1 은 마스터가 뜬 뒤에만 — 안 그러면 roslaunch 가 자기 마스터를 띄워 경쟁한다. ROS2 엔 마스터가 없어 이 검사가 없다.
let rbProc = null;
async function ensureRosbridge() {
  if (!RB_LOCAL) return;                                  // 원격 rosbridge 는 우리가 띄우지 않는다
  if (rbProc && rbProc.exitCode === null) return;         // 기동 중
  if (await tcpOpen(RB_PORT)) return;                     // 이미 떠 있음(공유)
  if (VER !== '2' && !(await tcpOpen(MASTER_PORT))) return;   // ROS1: 마스터 대기
  // 포트를 반드시 넘긴다. 안 넘기면 launch 파일 기본값(9090)에 바인딩하는데, 우리가 붙는 주소는
  // RDASH_ROSBRIDGE_URL 이라 포트를 바꾼 순간 "9090 에 띄우고 9091 에 붙는" 상태가 되어 영영 못 붙는다.
  // 컨테이너를 host 네트워크로 여러 개 띄우면(같은 네트워크 네임스페이스) 9090 이 하나뿐이라 이게 실제로 필요하다.
  const cmd = VER === '2' ? `ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=${RB_PORT}`
                          : `roslaunch rosbridge_server rosbridge_websocket.launch port:=${RB_PORT}`;
  // 루프백 강제(ROS1) — 전부 한 머신에 있을 때 호스트명 해석 실패를 피한다. 다른 머신이면 RDASH_LOOPBACK=0.
  const ros1Net = (VER === '2' || process.env.RDASH_LOOPBACK === '0')
    ? '' : 'unset ROS_HOSTNAME; export ROS_IP=${ROS_IP:-127.0.0.1}; ';
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
  return String.raw`source /opt/ros/*/setup.bash 2>/dev/null || true
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
