// ROS CLI 상호작용 — 백엔드가 rosapi 로는 못 하는 일(파라미터·rosbag·TF·리소스·브리지)을
// 셸로 하기 위한 명령 문자열 빌더 + 스폰. 프런트엔드는 이 파일을 쓰지 않는다(순수 텍스트 파서만 예외).
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

// 대역폭 스트림 명령
// rostopic/ros2 는 파이썬이라 stdbuf 가 안 먹는다(파이썬이 자체 버퍼링) → PYTHONUNBUFFERED 가 필요.
// bw 는 초당 수십 바이트만 뱉어서, 이게 없으면 4KB 버퍼가 안 차 몇 분간 아무것도 안 나온다.
export const bwCmd = (ver, name) => ver === '2'
  ? `PYTHONUNBUFFERED=1 stdbuf -oL ros2 topic bw '${name}' 2>&1`
  : `PYTHONUNBUFFERED=1 stdbuf -oL rostopic bw '${name}' 2>&1`;

// ── 노드 이름으로 프로세스 찾기 (kill/restart 공용) ──────────────────────────
//
// 예전엔 `pgrep -f "$TOK"` 였다. 이건 **명령줄 어디에든** 토큰이 있으면 잡는다. 노드 이름이
// talker·map·test 같은 흔한 단어면 무관한 프로세스까지 죽인다. 실제로 이 코드가
// `curl -d '{"name":"/talker"}'` 를 보낸 curl 자신에게 SIGINT 를 쐈다(ROS2 검증 중 확인).
//
// 그래서 두 가지만 본다:
//   (a) argv[0](실행 파일 경로)에 노드명이 경로 요소나 파일명 접두로 들어 있는가
//       — ROS2 turtlesim 은 노드 /turtlesim, 실행파일 .../turtlesim/turtlesim_node 라 둘 다 걸린다.
//   (b) 리매핑 인자 __name:=TOK (ROS1) / __node:=TOK (ROS2)
// 뒤쪽 인자에 이름이 우연히 들어간 프로세스(우리 curl 같은)는 (a)(b) 어디에도 안 걸린다.
//
// 못 찾으면 조용히 아무것도 안 죽인다(오검출로 남의 프로세스를 죽이는 것보다 낫다).
// 리매핑도 없고 실행파일 이름도 노드명과 무관한 노드(플러그인/컴포넌트)는 못 잡는다 — best-effort.
// pgrep 도, 셸 case 문도 쓰지 않는다.
//   · pgrep -f 는 후보 생성마저 정규식이고(노드명의 . + 가 메타문자가 된다) 명령줄 어디에 걸려도 잡는다.
//   · /proc/PID/cmdline 은 인자가 NUL 로 구분된다. 셸에서 공백으로 join 하면 인자 경계가 사라져
//     "인자 안의 공백"과 "인자 사이의 공백"을 구별할 수 없다.
// 그래서 파이썬으로 /proc 을 직접 훑는다(이미 필수 의존성이고, 인자 경계를 정확히 다룬다).
//
// 매칭 규칙 — 앞쪽 3 개 인자 중 "경로처럼 생긴 것"(/ 로 시작)만 본다:
//   · basename 이 노드명과 같거나 노드명_ 으로 시작  (talker, turtlesim_node)
//   · 경로에 /노드명/ 이 들어 있음                   (.../turtlesim/turtlesim_node)
//   · 또는 리매핑 인자 __name:=TOK(ROS1) / __node:=TOK(ROS2) 가 인자 하나와 정확히 일치
// argv[0] 만 보면 안 된다 — 파이썬 노드는 shebang 때문에 argv[0] 가 인터프리터고 스크립트는 argv[1] 이다
// (ros2 run demo_nodes_py talker). 반대로 뒤쪽 인자까지 보면 안 된다 — curl 의 -d '{"name":"/talker"}' 가
// 걸려서 그 curl 을 죽인다(실제로 그랬다).
//
// SELF(이 셸)·부모(우리를 띄운 백엔드)·1 은 절대 후보가 아니다. 이게 없으면 노드 이름이 'node' 인 순간
// argv[0] 가 .../bin/node 인 **우리 백엔드가** 걸려 자살한다.
//
// 못 찾으면 아무것도 안 죽인다. 오검출로 남의 프로세스를 죽이는 것보다 낫다 — best-effort 다.
const NODE_PIDS_PY = `python3 -c '
import os, sys
tok = sys.argv[1]
skip = {int(sys.argv[2]), int(sys.argv[3]), 1}
hits = []
for d in os.listdir("/proc"):
    if not d.isdigit(): continue
    pid = int(d)
    if pid in skip: continue
    try:
        raw = open("/proc/%d/cmdline" % pid, "rb").read()
    except OSError:
        continue
    args = [a.decode("utf-8", "replace") for a in raw.split(b"\\0") if a]
    if not args: continue
    hit = False
    for a in args[:3]:
        if not a.startswith("/"): continue
        b = os.path.basename(a)
        if b == tok or b.startswith(tok + "_") or ("/" + tok + "/") in a:
            hit = True
            break
    if not hit:
        hit = any(a == "__name:=" + tok or a == "__node:=" + tok for a in args)
    if hit: hits.append(pid)
print(" ".join(str(p) for p in sorted(hits)))'`;
const NODE_PIDS_SH = `PIDS=$(${NODE_PIDS_PY} "$TOK" $$ $PPID 2>/dev/null); `;

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
      // ROS2 엔 `rosnode kill` 이 없다 → 프로세스를 찾아 SIGINT (best-effort). 매칭 규칙은 NODE_PIDS_SH 참조.
      const cmd = `NODE='${name}'; TOK=$(basename "$NODE"); ${NODE_PIDS_SH}`
        + `if [ -z "$PIDS" ]; then echo "no proc for $TOK (플러그인/컴포넌트 노드거나 실행파일 이름이 노드명과 무관)"; `
        + `else kill -INT $PIDS 2>/dev/null; echo "SIGINT -> $PIDS"; fi`;
      return { label: 'kill node (ROS2 SIGINT, best-effort)', cmd };
    }
    return { label: 'kill node', cmd: `rosnode kill '${name}'` };   // ROS1 은 마스터가 정상 등록 해제까지 해준다
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

// r 키: 노드 재시작 — 죽이기 전에 명령줄/작업디렉토리를 캡처하고 SIGINT, 같은 명령을 setsid 로 detach 재실행.
// 프로세스 찾기는 kill 과 같은 규칙(NODE_PIDS_SH).
//
// 명령줄 복원에 주의: /proc/PID/cmdline 은 인자가 NUL 로 구분된다. 예전엔 `tr '\0' ' '` 로 공백 join 한 뒤
// `bash -c "exec $CMD"` 로 재실행했는데, 그러면 **인자 안의 공백이 인자 경계로 둔갑한다**
// (--params-file '/path with space/x.yaml' → 두 인자로 쪼개져 재시작 실패). NUL 경계를 살려 각 인자를
// 셸 인용해서 붙인다. 작업 디렉토리도 원래대로 되돌린다(상대경로 인자를 쓰는 노드가 있다).
const RESTART_CMDLINE_PY = `python3 -c '
import sys, shlex
raw = open("/proc/%s/cmdline" % sys.argv[1], "rb").read()
args = [a.decode("utf-8", "replace") for a in raw.split(b"\\0") if a]
sys.stdout.write(" ".join(shlex.quote(a) for a in args))'`;
export function restartFor(kind, name) {
  if (kind !== 'node') return null;
  const cmd = `NODE='${name}'; TOK=$(basename "$NODE"); ${NODE_PIDS_SH}`
    + `if [ -z "$PIDS" ]; then echo "no proc for $TOK (restart 불가: 플러그인/launch 노드거나 실행파일 이름이 노드명과 무관)"; `
    + `else TGT=$(echo $PIDS | awk '{print $1}'); `
    + `CMD=$(${RESTART_CMDLINE_PY} "$TGT"); CWD=$(readlink /proc/$TGT/cwd 2>/dev/null || echo /); `
    + `if [ -z "$CMD" ]; then echo "restart 불가: $TOK 의 명령줄을 읽지 못했다"; else `
    + `kill -INT $PIDS 2>/dev/null; `
    + `setsid bash -c "cd $(printf %q "$CWD") 2>/dev/null; sleep 1; exec $CMD" >/dev/null 2>&1 </dev/null & `
    + `echo "restart: $TOK (was $PIDS)"; fi; fi`;
  return { label: 'restart node', cmd };
}

// ── 메시지 스켈레톤(발행 템플릿) 생성 ─────────────────────────────────────────
// x 로 토픽 publish 시, 사용자가 "{linear: {x: 0.0, ...}}" 전체를 손으로 안 쳐도 되도록
// 타입에서 기본값 채운 flow-style YAML 한 줄을 만들어 입력창에 미리 넣는다.
//   ROS2: `ros2 interface proto <type>` 결과를 한 줄로 압축.
//   ROS1: roslib 로 메시지 클래스를 인트로스펙트해 필드 기본값 트리를 만든다.
// stdout 은 JSON 한 줄 {type, skel} — 폼(필드명↦기본값)으로 펼치고 다시 YAML 로 조립하기 쉽게.
const PROTO_PY2 = `python3 -c 'import sys,yaml,json
s=sys.stdin.read().split(chr(10)+"---")[0].strip()
if len(s)>1 and s[0]=="\\"" and s[-1]=="\\"": s=s[1:-1]
print(json.dumps({"type":sys.argv[1],"skel":yaml.safe_load(s) or {}}))'`;

// ROS1 인트로스펙션 공용 헬퍼(메시지/서비스 요청 둘 다 sk()로 스켈레톤화) — 토픽·서비스 명령이 공유.
const PY1_HELPERS = `import sys,json,roslib.message
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
    return sk(roslib.message.get_message_class(t))`;

const PROTO_PY1 = `python3 -c '${PY1_HELPERS}
print(json.dumps({"type":sys.argv[1],"skel":sk(roslib.message.get_message_class(sys.argv[1]))}))'`;

// 서비스 요청 스켈레톤 — get_service_class(TYPE)._request_class 를 같은 sk()로 펼친다.
const PROTO_PY1_SRV = `python3 -c '${PY1_HELPERS}
srv=roslib.message.get_service_class(sys.argv[1])
print(json.dumps({"type":sys.argv[1],"skel":sk(srv._request_class if srv else None)}))'`;

// 발행/호출 폼 스켈레톤 명령 — 토픽·서비스 공용. 타입을 알면(ty) 조회를 건너뛴다. stdout: JSON {type, skel}.
//   서비스는 그래프 스냅샷에 ty 가 없어(API.md) ty 미지정이 기본 — 이름으로 타입을 조회해야 한다.
export function protoCmd(ver, kind, name, ty) {
  if (kind !== 'topic' && kind !== 'service') return null;
  if (ver === '2') {
    const typeCmd = kind === 'service' ? `ros2 service type ${shq(name)}` : `ros2 topic type ${shq(name)}`;
    const t = ty ? `T=${shq(ty)}` : `T=$(${typeCmd} 2>/dev/null | head -1)`;
    return `${t}; [ -z "$T" ] && exit 0; ros2 interface proto "$T" 2>/dev/null | ${PROTO_PY2} "$T"`;
  }
  const typeCmd = kind === 'service' ? `rosservice type ${shq(name)}` : `rostopic type ${shq(name)}`;
  const t = ty ? `T=${shq(ty)}` : `T=$(${typeCmd} 2>/dev/null | head -1)`;
  return `${t}; [ -z "$T" ] && exit 0; ${kind === 'service' ? PROTO_PY1_SRV : PROTO_PY1} "$T"`;
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
