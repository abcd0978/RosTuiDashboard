// 부가 기능용 셸 명령 빌더 — 연결 뷰, 노드 리소스, TF 트리, rosbag.
import { shq } from './util.js';
import { TF_TREE_PY } from './paths.js';

// 연결(pub/sub): 토픽=발행/구독 노드, 노드=in/out 토픽, 서비스=서버.
export const connectionsCmd = (ver, kind, name) => {
  if (kind === 'topic') return ver === '2' ? `ros2 topic info -v ${shq(name)} 2>&1` : `rostopic info ${shq(name)} 2>&1`;
  if (kind === 'node') return ver === '2' ? `ros2 node info ${shq(name)} 2>&1` : `rosnode info ${shq(name)} 2>&1`;
  if (kind === 'service') return ver === '2' ? `ros2 service type ${shq(name)} 2>&1` : `rosservice info ${shq(name)} 2>&1`;
  return `echo '연결 정보 없음'`;
};

// 메시지/서비스 타입 정의 표시 (선택 토픽/서비스의 필드 구조).
export const msgDefCmd = (ver, ty) => ver === '2'
  ? `ros2 interface show ${shq(ty)} 2>&1`
  : `rosmsg show ${shq(ty)} 2>&1`;

// 노드 리소스: 노드명 토큰으로 PID 찾아 /proc·ps 에서 CPU%/RSS. (best-effort: 독립 프로세스 노드만)
export const resourceCmd = (nodes) => {
  const args = nodes.slice(0, 60).map(shq).join(' ');
  return `for NODE in ${args || "''"}; do TOK=$(basename "$NODE"); `
    + `for p in $(pgrep -f -- "$TOK" 2>/dev/null | head -4); do `
    + `grep -qa "TOK=" /proc/$p/cmdline 2>/dev/null && continue; `
    + `rss=$(awk '/VmRSS/{printf "%.0f MB", $2/1024}' /proc/$p/status 2>/dev/null); `
    + `cpu=$(ps -o %cpu= -p $p 2>/dev/null | tr -d ' '); `
    + `printf '%-26s pid %-7s cpu %5s%%  %s\\n' "$NODE" "$p" "\${cpu:-?}" "\${rss:-?}"; `
    + `done; done | sort -t% -k1 2>/dev/null; echo '(CPU% = ps 평균, 독립 프로세스 노드만)'`;
};

// 두 프레임 간 실시간 변환(translation/rotation + 거리). 잠깐 실행 후 openInfo 가 주기 갱신.
export const tfEchoCmd = (ver, src, tgt) => ver === '2'
  ? `timeout 2 ros2 run tf2_ros tf2_echo ${shq(src)} ${shq(tgt)} 2>&1`
  : `timeout 2 rosrun tf tf_echo ${shq(src)} ${shq(tgt)} 2>&1`;

// TF 트리: /tf(+/tf_static) 를 잠깐 수집해 tf_tree.py 로 계층 출력.
export const tfTreeCmd = (ver) => {
  const echo = (t) => ver === '2' ? `timeout 3 ros2 topic echo ${t} 2>/dev/null` : `timeout 3 rostopic echo ${t} 2>/dev/null`;
  return `{ ${echo('/tf')}; ${echo('/tf_static')}; } | python3 ${shq(TF_TREE_PY)}`;
};

// rosbag 녹화: 토픽 목록(없으면 -a 전체). SIGINT 로 정지. 재생: 경로 지정.
export const bagRecordCmd = (ver, topics, out) => {
  const sel = topics && topics.length ? topics.map(shq).join(' ') : '-a';
  return ver === '2' ? `ros2 bag record -o ${shq(out)} ${sel} 2>&1` : `rosbag record -O ${shq(out)} ${sel} 2>&1`;
};
export const bagPlayCmd = (ver, path) =>
  ver === '2' ? `ros2 bag play ${shq(path)} 2>&1` : `rosbag play ${shq(path)} 2>&1`;

// A/B bag 비교 — 두 bag 의 info(토픽·기간·메시지 수·크기)를 나란히 출력.
export const bagCompareCmd = (ver, a, b) => {
  const info = (p) => (ver === '2' ? `ros2 bag info ${shq(p)}` : `rosbag info ${shq(p)}`);
  return `{ echo '===== A ====='; ${info(a)}; echo; echo '===== B ====='; ${info(b)}; } 2>&1`;
};
