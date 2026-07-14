// ROS CLI 상호작용 — 명령 문자열 빌더, 서브프로세스 스폰, 제어 액션, 필드 추출.
// 이 프로그램은 "ROS 가 되는 셸(rostopic/rospy·ros2 동작)"에서 실행된다고만 가정한다.
// 현재 셸의 ROS 환경(ROS_MASTER_URI 등)을 그대로 상속 — 도커/런치/프로젝트 스크립트는 모른다.
import { spawn } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { shq } from './util.js';
import { PY_COMMON } from './paths.js';

export function rosSpawn(inner, env, detached) {
  // 로그인셸(-l) 아님 → 현재 env 그대로 상속. env 지정 시 덧씌움(RDASH_CTRL, ROS_DOMAIN_ID 등).
  // detached=true → 새 프로세스 그룹(리더). 파이프라인 자식까지 그룹째 종료(process.kill(-pid))하기 위함.
  // PYTHONPATH: 브리지 스크립트는 backend/python 하위 디렉토리에 있어 sys.path[0] 가 자기 디렉토리다.
  // 공용 shim(ros_compat)은 common/ 에 있으므로 여기서 넣어줘야 `import ros_compat` 이 풀린다.
  const pyPath = [PY_COMMON, process.env.PYTHONPATH].filter(Boolean).join(':');
  const opts = { env: { ...process.env, PYTHONPATH: pyPath, ...env } };
  if (detached) opts.detached = true;
  return spawn('bash', ['-c', inner], opts);
}

// /proc 을 훑어 root 의 자손 pid 를 전부 모은다(깊이 무관).
// setsid 는 세션/프로세스그룹만 바꾸고 PPid 는 그대로 두므로, 부모가 살아있는 동안에만 정확하다.
function procDescendants(root) {
  const kids = new Map();
  for (const e of readdirSync('/proc')) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const st = readFileSync(`/proc/${e}/stat`, 'utf8');
      const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);   // comm 에 공백/괄호가 있어 뒤에서 자른다
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(e));
    } catch { /* 그 사이 종료된 pid */ }
  }
  const out = [], stack = [root];
  while (stack.length) for (const c of kids.get(stack.pop()) || []) { out.push(c); stack.push(c); }
  return out;
}

const sigPid = (pid, sig) => { try { process.kill(pid, sig); return true; } catch { return false; } };

// 프로세스 종료 — 그룹째 + 자손 pid 직접.
//
// roslaunch 는 각 노드(px4/gzserver/mavros/rosmaster)를 setsid 로 **독립 세션**에 넣는다.
// 그래서 그룹 킬 `kill(-pid)` 은 roslaunch 에만 닿는다. SIGINT 면 roslaunch 가 노드를 정리해주지만,
// SIGKILL 이면 정리할 틈 없이 즉사해 노드들이 고아로 영원히 남는다(실측 확인).
// → 신호를 보내기 **전에** 자손 목록을 떠서 각 pid 에 직접 보낸다.
export function killTree(child, sig = 'SIGINT') {
  if (!child || !child.pid) return;
  const kids = procDescendants(child.pid);              // 부모가 죽기 전에 떠야 한다
  if (!sigPid(-child.pid, sig)) { try { child.kill(sig); } catch { /* */ } }
  for (const pid of kids) sigPid(pid, sig);
}

// 강제 종료 — 먼저 SIGINT 로 정상 종료 기회를 주고, graceMs 후에도 살아있는 것만 SIGKILL.
// SIGKILL 을 곧바로 쏘면 roslaunch 가 노드를 정리하지 못하므로 이 단계가 필요하다.
export function killTreeHard(child, graceMs = 6000) {
  if (!child || !child.pid) return;
  const all = [child.pid, ...procDescendants(child.pid)];
  killTree(child, 'SIGINT');
  setTimeout(() => {
    sigPid(-child.pid, 'SIGKILL');
    for (const pid of all) if (sigPid(pid, 0)) sigPid(pid, 'SIGKILL');   // 0 = 생존 확인
  }, graceMs).unref?.();
}

// 값/정보 조회 명령 (버전별)
export const echoCmd = (ver, name) => ver === '2'
  ? `stdbuf -oL ros2 topic echo '${name}' 2>&1`
  : `stdbuf -oL rostopic echo --noarr '${name}' 2>&1`;

export const infoCmd = (ver, kind, name) => ver === '2'
  ? (kind === 'service' ? `ros2 service type '${name}' 2>&1`
    : kind === 'node' ? `ros2 node info '${name}' 2>&1`
      : kind === 'param' ? `echo 'ROS2: 파라미터는 노드별 (nodes 에서 확인)'`
        : `ros2 topic info '${name}' 2>&1`)
  : (kind === 'param' ? `rosparam get '${name}' 2>&1`
    : kind === 'service' ? `rosservice info '${name}' 2>&1`
      : kind === 'node' ? `rosnode info '${name}' 2>&1`
        : `rostopic info '${name}' 2>&1`);

// 전체 메시지 echo(YAML) — 플롯용. plot.py 가 stdin 에서 필드를 뽑아 그린다.
export const echoFullCmd = (ver, name) => ver === '2'
  ? `stdbuf -oL ros2 topic echo '${name}'`
  : `stdbuf -oL rostopic echo '${name}'`;

// 대역폭 스트림 명령
export const bwCmd = (ver, name) => ver === '2'
  ? `stdbuf -oL ros2 topic bw '${name}' 2>&1`
  : `stdbuf -oL rostopic bw '${name}' 2>&1`;

// ── 제어 액션 (RViz 와의 차별점) — 선택 항목에 x 로 실행 ──────────────────────
//   node: 죽이기 / service: 호출 / param: 값 설정(needsInput). 반환 {label, cmd} 또는 null.
export function actionFor(ver, kind, name, arg) {
  if (kind === 'action') return { label: 'send goal', needsInput: true, defaultVal: '{}', cmd: null };   // 실제 전송은 store.submitActionGoal
  if (kind === 'param') {
    if (ver === '2') return { label: 'set param (ROS2: per-node, N/A)', cmd: null };
    return { label: 'set param', needsInput: true, cmd: arg != null ? `rosparam set '${name}' '${arg}'` : null };
  }
  if (kind === 'service') {
    // 인자 있는 호출 지원 — x → 요청(YAML/JSON) 입력창(기본 '{}'). Gazebo spawn/set_entity_state 등에 유용.
    const req = arg != null ? arg : '{}';
    return ver === '2'
      ? { label: 'call service', needsInput: true, defaultVal: '{}',
        cmd: arg != null ? `ros2 service call ${shq(name)} $(ros2 service type ${shq(name)}) ${shq(req)} 2>&1` : null }
      : { label: 'call service', needsInput: true, defaultVal: '{}',
        cmd: arg != null ? `rosservice call ${shq(name)} ${shq(req)} 2>&1` : null };
  }
  if (kind === 'node') {
    if (ver === '2') {
      // ROS2 엔 `rosnode kill` 이 없음 → 노드명 토큰으로 프로세스를 찾아 SIGINT (best-effort).
      // cmdline 에 우리 표식 "TOK=" 가 든 프로세스(=이 kill 셸)는 제외 → 자기 자신을 오검출/자살하지 않음.
      const cmd = `NODE='${name}'; TOK=$(basename "$NODE"); PIDS=""; `
        + `for p in $(pgrep -f -- "$TOK"); do `
        + `grep -qa "TOK=" /proc/$p/cmdline 2>/dev/null || PIDS="$PIDS $p"; done; `
        + `PIDS=$(echo $PIDS); `
        + `if [ -z "$PIDS" ]; then echo "no proc for $TOK (plugin/component node?)"; `
        + `else kill -INT $PIDS 2>/dev/null; echo "SIGINT -> $PIDS"; fi`;
      return { label: 'kill node (ROS2 SIGINT, best-effort)', cmd };
    }
    return { label: 'kill node', cmd: `rosnode kill '${name}'` };
  }
  if (kind === 'topic') {
    // 토픽 publish(1회) — arm/disarm, 테스트 메시지 등. 연속 스트림은 북마크/launch 로.
    const msg = arg != null ? arg : '{}';
    return ver === '2'
      ? { label: 'publish (once)', needsInput: true, defaultVal: '{}',
        cmd: arg != null ? `ros2 topic pub --once ${shq(name)} $(ros2 topic type ${shq(name)}) ${shq(msg)} 2>&1` : null }
      : { label: 'publish (once)', needsInput: true, defaultVal: '{}',
        cmd: arg != null ? `rostopic pub -1 ${shq(name)} $(rostopic type ${shq(name)}) ${shq(msg)} 2>&1` : null };
  }
  return null;
}

// r 키: 노드 재시작 — 죽이기 전에 /proc/PID/cmdline 캡처 후 SIGINT, 같은 명령을 setsid 로 detach 재실행.
export function restartFor(kind, name) {
  if (kind !== 'node') return null;
  const cmd = `NODE='${name}'; TOK=$(basename "$NODE"); C15=$(printf %.15s "$TOK"); PIDS=""; TGT=""; `
    + `for p in $(pgrep -f -- "$TOK"); do grep -qa "TOK=" /proc/$p/cmdline 2>/dev/null && continue; `
    + `[ -z "$(tr -d '\\0' < /proc/$p/cmdline 2>/dev/null)" ] && continue; `
    + `PIDS="$PIDS $p"; [ "$(cat /proc/$p/comm 2>/dev/null)" = "$C15" ] && TGT=$p; done; `
    + `if [ -z "$PIDS" ]; then echo "no proc for $TOK (restart 불가: 플러그인/launch 노드)"; `
    + `else [ -z "$TGT" ] && TGT=$(echo $PIDS | awk '{print $1}'); `
    + `CMD=$(tr '\\0' ' ' < /proc/$TGT/cmdline); kill -INT $PIDS 2>/dev/null; `
    + `setsid bash -c "sleep 1; exec $CMD" >/dev/null 2>&1 </dev/null & echo "restart: $TOK (was $PIDS)"; fi`;
  return { label: 'restart node', cmd };
}

// ── 메시지 스켈레톤(발행 템플릿) 생성 ─────────────────────────────────────────
// x 로 토픽 publish 시, 사용자가 "{linear: {x: 0.0, ...}}" 전체를 손으로 안 쳐도 되도록
// 타입에서 기본값 채운 flow-style YAML 한 줄을 만들어 입력창에 미리 넣는다.
//   ROS2: `ros2 interface proto <type>` 결과를 한 줄로 압축.
//   ROS1: roslib 로 메시지 클래스를 인트로스펙트해 필드 기본값 트리를 만든다.
// stdout 은 JSON 한 줄 {type, skel} — 폼(필드명↦기본값)으로 펼치고 다시 YAML 로 조립하기 쉽게.
const PROTO_PY2 = `python3 -c 'import sys,yaml,json
s=sys.stdin.read().strip()
if len(s)>1 and s[0]=="\\"" and s[-1]=="\\"": s=s[1:-1]
print(json.dumps({"type":sys.argv[1],"skel":yaml.safe_load(s) or {}}))'`;

const PROTO_PY1 = `python3 -c 'import sys,json,roslib.message
def sk(cls):
    if cls is None: return {}
    m=cls(); o={}
    for n,t in zip(m.__slots__,m._slot_types): o[n]=fld(t)
    return o
def fld(t):
    if "[" in t: return []
    if t in ("float32","float64"): return 0.0
    if t in ("int8","uint8","int16","uint16","int32","uint32","int64","uint64","byte","char"): return 0
    if t=="bool": return False
    if t=="string": return ""
    if t in ("time","duration"): return {"secs":0,"nsecs":0}
    return sk(roslib.message.get_message_class(t))
print(json.dumps({"type":sys.argv[1],"skel":sk(roslib.message.get_message_class(sys.argv[1]))}))'`;

// 발행 폼 스켈레톤 명령 — 토픽만. 타입을 알면(ty) 조회를 건너뛴다. stdout: JSON {type, skel}.
export function protoCmd(ver, kind, name, ty) {
  if (kind !== 'topic') return null;
  if (ver === '2') {
    const t = ty ? `T=${shq(ty)}` : `T=$(ros2 topic type ${shq(name)} 2>/dev/null | head -1)`;
    return `${t}; [ -z "$T" ] && exit 0; ros2 interface proto "$T" 2>/dev/null | ${PROTO_PY2} "$T"`;
  }
  const t = ty ? `T=${shq(ty)}` : `T=$(rostopic type ${shq(name)} 2>/dev/null | head -1)`;
  return `${t}; [ -z "$T" ] && exit 0; ${PROTO_PY1} "$T"`;
}

// 명령의 전체 stdout(trim)을 콜백으로 — 스켈레톤 등 한 덩어리 결과용.
export function runText(cmd, onDone) {
  const p = rosSpawn(cmd);
  let out = '';
  if (p.stderr) p.stderr.on('data', () => {});
  p.stdout.on('data', (d) => { out += d.toString(); });
  p.on('close', () => onDone(out.trim()));
  p.on('error', () => onDone(''));
}

// 액션 실행 → 첫 줄 결과를 콜백으로
export function runAction(cmd, onDone) {
  const p = rosSpawn(`${cmd} 2>&1`);
  let out = '';
  if (p.stderr) p.stderr.on('data', () => {});
  p.stdout.on('data', (d) => { out += d.toString(); });
  p.on('close', () => onDone((out.trim().split('\n')[0] || 'done').slice(0, 60)));
  p.on('error', () => onDone('action error'));
}

// echo YAML 텍스트에서 지정 점(.) 경로의 값 문자열을 추출(워치리스트용). 없으면 undefined.
export function fieldValue(text, dotted) {
  const target = dotted.split('.');
  const stack = [];
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim() || raw.trim() === '---') continue;
    const indent = raw.length - raw.trimStart().length;
    const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), key];
    if (val === '') { stack.push({ indent, key }); continue; }
    if (path.length === target.length && path.every((p, i) => p === target[i])) return val;
  }
  return undefined;
}

// echo YAML 텍스트에서 "숫자 leaf" 필드들의 점(.) 경로 목록 추출(플롯 대상 선택용).
export function numericFields(text) {
  const out = [];
  const stack = [];   // [{indent, key}]
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim() || raw.trim() === '---') continue;
    const indent = raw.length - raw.trimStart().length;
    const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), key].join('.');
    if (val === '') { stack.push({ indent, key }); continue; }   // 중첩 헤더
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) out.push(path);   // 숫자 리프
  }
  return [...new Set(out)];
}
