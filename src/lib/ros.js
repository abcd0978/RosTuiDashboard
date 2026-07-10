// ROS CLI 상호작용 — 명령 문자열 빌더, 서브프로세스 스폰, 제어 액션, 필드 추출.
// 이 프로그램은 "ROS 가 되는 셸(rostopic/rospy·ros2 동작)"에서 실행된다고만 가정한다.
// 현재 셸의 ROS 환경(ROS_MASTER_URI 등)을 그대로 상속 — 도커/런치/프로젝트 스크립트는 모른다.
import { spawn } from 'child_process';
import { shq } from './util.js';

export function rosSpawn(inner, env, detached) {
  // 로그인셸(-l) 아님 → 현재 env 그대로 상속. env 지정 시 덧씌움(RDASH_CTRL, ROS_DOMAIN_ID 등).
  // detached=true → 새 프로세스 그룹(리더). 파이프라인 자식까지 그룹째 종료(process.kill(-pid))하기 위함.
  const opts = {};
  if (env) opts.env = { ...process.env, ...env };
  if (detached) opts.detached = true;
  return spawn('bash', ['-c', inner], opts);
}

// 프로세스(및 그 그룹) 종료 — detached 로 띄운 자식은 그룹째, 아니면 자식만.
export function killTree(child, sig = 'SIGINT') {
  if (!child || !child.pid) return;
  try { process.kill(-child.pid, sig); }          // 그룹째(파이프라인 자식 포함)
  catch { try { child.kill(sig); } catch { /* */ } }   // 폴백: 자식만
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
