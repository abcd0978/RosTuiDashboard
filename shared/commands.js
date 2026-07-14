// 부가 기능용 셸 명령 빌더 — 연결 뷰, 노드 리소스, TF 트리, rosbag.
import { shq } from './util.js';
import { TF_TREE_PY } from './paths.js';

// 연결(pub/sub): 토픽=발행/구독 노드, 노드=in/out 토픽, 서비스=서버.
export const msgDefCmd = (ver, ty) => ver === '2'
  ? `ros2 interface show ${shq(ty)} 2>&1`
  : `rosmsg show ${shq(ty)} 2>&1`;

// ROS2 노드 파라미터: 이름<TAB>값 목록 / 값 설정 / 단일 값 조회.
//
// `ros2 param dump` 로 한 번에 다 받는다. 예전엔 `ros2 param list` 후 파라미터마다 `ros2 param get` 을
// 돌렸는데, ros2 CLI 한 번이 ~1.2 초(파이썬 기동 + 디스커버리)라 파라미터 8 개짜리 turtlesim 에도
// 10 초가 걸렸다(50 개면 1 분). dump 는 호출 1 번, 1.2 초 — 파라미터 개수와 무관하다.
// dump 는 중첩 YAML 을 뱉으므로 점(.)으로 이어 붙여 `ros2 param list` 와 같은 평평한 이름으로 되돌린다
// (예: qos_overrides./parameter_events.publisher.depth).
const PARAM_FLATTEN_PY = `python3 -c '
import sys, yaml
d = yaml.safe_load(sys.stdin) or {}
p = (next(iter(d.values()), {}) or {}).get("ros__parameters", {}) or {}
def walk(o, pre=""):
    for k, v in o.items():
        n = pre + str(k)
        if isinstance(v, dict): walk(v, n + ".")
        else: sys.stdout.write("%s\\t%s\\n" % (n, v))
walk(p)'`;
export const paramListCmd = (node) =>
  `ros2 param dump ${shq(node)} 2>/dev/null | ${PARAM_FLATTEN_PY}`;
export const paramGetCmd = (node, name) =>
  `ros2 param get ${shq(node)} ${shq(name)} 2>/dev/null | sed -n 's/.*value is: //p'`;
export const paramSetCmd = (node, name, val) =>
  `ros2 param set ${shq(node)} ${shq(name)} ${shq(val)} 2>&1`;

// 노드 리소스: 노드명 토큰으로 PID 찾아 /proc·ps 에서 CPU%/RSS/스레드. CPU% 내림차순. (best-effort: 독립 프로세스 노드만)
export const resourceCmd = (nodes) => {
  const args = nodes.slice(0, 60).map(shq).join(' ');
  return `{ for NODE in ${args || "''"}; do TOK=$(basename "$NODE"); `
    + `for p in $(pgrep -f -- "$TOK" 2>/dev/null | head -4); do `
    + `rss=$(awk '/VmRSS/{printf "%.0f", $2/1024}' /proc/$p/status 2>/dev/null); `
    + `thr=$(awk '/Threads/{print $2}' /proc/$p/status 2>/dev/null); `
    + `cpu=$(ps -o %cpu= -p $p 2>/dev/null | tr -d ' '); `
    + `printf '%6s  %-24s  pid %-7s %6s MB  %3s thr\\n' "\${cpu:-0}" "$NODE" "$p" "\${rss:-?}" "\${thr:-?}"; `
    + `done; done | sort -rn; }; echo '(CPU% 내림차순 · RSS/스레드 · 독립 프로세스 노드만)'`;
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
