#!/usr/bin/env node
// RDash — ROS 토픽/서비스/파라미터/노드 대시보드 TUI (ROS1 & ROS2).
// 왼쪽: 네임스페이스 트리(열고 접기), 오른쪽: 선택 항목 값 실시간. ROS 되는 셸에서 `node index.js`.
import React, { useState, useEffect, useRef } from 'react';
import { EventEmitter } from 'node:events';
import { render, Box, Text, useApp, useInput } from 'ink';
import { MouseProvider, useMouse, useOnMouseState, useOnMouseClick, useElementPosition } from '@zenobius/ink-mouse';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

EventEmitter.defaultMaxListeners = 0;   // 마우스 리스너 다수 → 경고(stderr) 방지
const h = React.createElement;
const DIR = dirname(fileURLToPath(import.meta.url));
const TELEM = readFileSync(join(DIR, 'telemetry.py'), 'utf8');
const TELEM2 = readFileSync(join(DIR, 'telemetry_ros2.py'), 'utf8');

// ROS 버전 감지: ROS_VER env 우선, 없으면 ros2/rostopic 존재로 판단(둘 다면 ros2 우선).
function useRosVersion() {
  const [ver, setVer] = useState(process.env.ROS_VER || null);
  useEffect(() => {
    if (ver) return;
    const p = spawn('bash', ['-c', 'command -v ros2 >/dev/null && echo 2 || echo 1']);
    let o = '';
    p.stdout.on('data', (d) => { o += d.toString(); });
    p.on('close', () => setVer(o.trim() === '2' ? '2' : '1'));
    p.on('error', () => setVer('1'));
  }, []);
  return ver;
}
// 값/정보 조회 명령 (버전별)
const echoCmd = (ver, name) => ver === '2'
  ? `stdbuf -oL ros2 topic echo '${name}' 2>&1`
  : `stdbuf -oL rostopic echo --noarr '${name}' 2>&1`;
const infoCmd = (ver, kind, name) => ver === '2'
  ? (kind === 'service' ? `ros2 service type '${name}' 2>&1`
    : kind === 'node' ? `ros2 node info '${name}' 2>&1`
      : kind === 'param' ? `echo 'ROS2: 파라미터는 노드별 (nodes 에서 확인)'`
        : `ros2 topic info '${name}' 2>&1`)
  : (kind === 'param' ? `rosparam get '${name}' 2>&1`
    : kind === 'service' ? `rosservice info '${name}' 2>&1`
      : kind === 'node' ? `rosnode info '${name}' 2>&1`
        : `rostopic info '${name}' 2>&1`);
// 이 프로그램은 "ROS 가 되는 환경(rostopic/rospy 가 동작하는 셸)"에서 실행된다고만 가정한다.
// 도커·컨테이너·프로젝트 스크립트를 전혀 모른다 — 현재 셸의 ROS 환경(ROS_MASTER_URI 등)을 그대로 상속.
// 사용: ROS 를 source 한 셸에서  node index.js  실행.
function rosSpawn(inner) {
  return spawn('bash', ['-c', inner]);   // 로그인셸(-l) 아님 → 현재 env 그대로 상속
}

// ── 제어 액션 (RViz 와의 차별점) — 선택 항목에 x 로 실행 ──────────────────────
//   node    : 죽이기(respawn/launch 면 자동 재기동)
//   service : 호출(인자 없는/기본 요청)
//   param   : 값 설정(x → 입력창)
// 반환: {label, cmd} 또는 null(해당 kind/버전에서 액션 없음). param 은 needsInput.
function actionFor(ver, kind, name, arg) {
  if (kind === 'param') {
    if (ver === '2') return { label: 'set param (ROS2: per-node, N/A)', cmd: null };
    return { label: 'set param', needsInput: true, cmd: arg != null ? `rosparam set '${name}' '${arg}'` : null };
  }
  if (kind === 'service') {
    return ver === '2'
      ? { label: 'call service', cmd: `ros2 service call '${name}' $(ros2 service type '${name}') '{}'` }
      : { label: 'call service', cmd: `rosservice call '${name}'` };
  }
  if (kind === 'node') {
    if (ver === '2') {
      // ROS2 엔 `rosnode kill` 이 없음 → 노드명 토큰으로 프로세스를 찾아 SIGINT (best-effort).
      //  · gazebo GUI 등엔 kill -9 금지(HANDOFF) → SIGINT 로 정중히 종료.
      //  · 플러그인/컴포넌트 노드(예: gazebo 내부 /turtlebot3_laserscan)는 독립 프로세스가
      //    아니라 매칭이 안 됨 → "no proc" 로 그대로 보고(못 죽인다는 사실을 숨기지 않음).
      //  · $$(=이 kill 셸)·$PPID(=RDash) 는 제외해 자기 자신을 죽이지 않음.
      // 매칭 후 cmdline 에 우리 스크립트 고유표식 "TOK=" 가 든 프로세스(=이 kill 셸/서브셸)는
      // 제외 → 자기 자신을 오검출/자살하지 않음. 실제 ROS2 노드 cmdline 엔 "TOK=" 가 없음.
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
  return null;
}
// r 키: 노드 재시작 — 죽이기 전에 /proc/PID/cmdline 을 캡처해두고, SIGINT 후 같은 명령을
//   setsid 로 detach 재실행. 독립 프로세스 노드만 가능(플러그인/launch-respawn 노드는 프로세스가
//   없거나 launch 가 알아서 재기동 → "no proc" 로 정직하게 보고). ROS1/ROS2 공통.
function restartFor(kind, name) {
  if (kind !== 'node') return null;
  //  주의: `ros2 run` 은 wrapper(comm=ros2)+실행파일(comm=node) 2프로세스 → 매칭 PID 를 전부
  //  종료(중복 스폰 방지)하고, 재실행 cmdline 은 실행파일(comm==노드명, 15자 절단 비교) 것만 사용.
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
function runAction(cmd, onDone) {
  const p = rosSpawn(`${cmd} 2>&1`);
  let out = '';
  if (p.stderr) p.stderr.on('data', () => {});
  p.stdout.on('data', (d) => { out += d.toString(); });
  p.on('close', () => onDone((out.trim().split('\n')[0] || 'done').slice(0, 60)));
  p.on('error', () => onDone('action error'));
}
const LEFT_W = 40;               // 왼쪽 트리 패널 폭
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad = (s, n) => (String(s) + ' '.repeat(Math.max(0, n))).slice(0, n);
const padL = (s, n) => (' '.repeat(Math.max(0, n)) + String(s)).slice(-n);

// ── Hz 스파크라인 — 최근 히스토리를 블록문자 미니그래프로 ──────────────────────
const SPARK = '▁▂▃▄▅▆▇█';
function sparkline(arr, w = 5) {
  if (!arr || !arr.length) return ' '.repeat(w);
  const recent = arr.slice(-w);
  const max = Math.max(...recent, 1);
  const s = recent.map((v) => v <= 0 ? '·' : SPARK[clamp(Math.round(v / max * (SPARK.length - 1)), 0, SPARK.length - 1)]).join('');
  return padL(s, w);
}
// 퍼지(서브시퀀스) 매치 — needle 문자들이 순서대로 hay 에 들어있으면 true. 둘 다 소문자 가정.
function fuzzy(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

// ── 토픽/Hz 스트림 ───────────────────────────────────────────────────────────
function useTopics(ver) {
  const [topics, setTopics] = useState(null);
  const [conn, setConn] = useState('starting');
  useEffect(() => {
    if (!ver) return;                          // 버전 감지 전엔 대기
    let child, buf = '', alive = true, timer;
    const start = () => {
      child = rosSpawn('python3 -');
      child.stdin.on('error', () => {});
      if (child.stderr) child.stderr.on('data', () => {});   // stderr 버림(파이프 막힘 방지)
      child.stdin.write(ver === '2' ? TELEM2 : TELEM); child.stdin.end();
      child.stdout.on('data', (d) => {
        buf += d.toString(); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          try { const o = JSON.parse(line); setConn('ok'); setTopics(o.nomaster ? null : (o.items || [])); } catch { /* */ }
        }
      });
      child.on('error', () => setConn('exec-error'));
      child.on('exit', () => { if (alive) { setConn('reconnecting'); timer = setTimeout(start, 2000); } });
    };
    start();
    return () => { alive = false; clearTimeout(timer); if (child) child.kill(); };
  }, [ver]);
  return { topics, conn };
}

// ── 터미널 크기(리사이즈 반영) ───────────────────────────────────────────────
function useTermSize() {
  const [s, setS] = useState({ cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 });
  useEffect(() => {
    const on = () => setS({ cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 });
    process.stdout.on('resize', on);
    return () => process.stdout.off('resize', on);
  }, []);
  return s;
}

const RATES = [1, 2, 5, 10, 15, 20, 30, 60];   // 선택 가능한 최대 렌더 rate(Hz)

// ── 선택 항목 값 — kind 별로 다르게 ─────────────────────────────────────────
//   topic   : rostopic echo 연속 스트리밍(메시지 오는 대로, 화면은 capRef Hz 로 캡)
//   param   : rosparam get 주기 폴링
//   service : rosservice info (정적)
//   node    : rosnode info (주기)
function useValue(active, capRef, ver, frozenRef) {
  const [text, setText] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active) { setText(''); return; }
    let alive = true, child, timer = null, buf = '', latest = '(수신 대기…)', last = 0;
    // frozen 이면 화면 갱신만 멈춤(자식 프로세스는 계속 → 해제 시 다음 메시지부터 재개).
    const push = () => { timer = null; last = Date.now(); if (alive && !frozenRef.current) setText(latest); };
    if (kind === 'topic') {
      const throttled = () => {
        const cap = capRef.current, now = Date.now();
        if (now - last >= cap) push();
        else if (!timer) timer = setTimeout(push, cap - (now - last));
      };
      child = rosSpawn(echoCmd(ver, name));
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n---\n');
        if (parts.length > 1) { const b = parts[parts.length - 2].trimEnd(); if (b) latest = b; buf = parts[parts.length - 1]; }
        throttled();
      });
      child.on('error', () => { if (alive) setText('(echo 오류)'); });
      return () => { alive = false; if (timer) clearTimeout(timer); if (child) child.kill(); };
    }
    // param / service / node : 주기 폴링(스트리밍 아님)
    const cmd = infoCmd(ver, kind, name);
    const interval = kind === 'param' ? 1000 : 3000;
    const poll = () => {
      let out = '';
      child = rosSpawn(cmd);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('close', () => { if (!alive) return; if (!frozenRef.current) setText(out.trimEnd() || '(빈 값)'); timer = setTimeout(poll, interval); });
      child.on('error', () => { if (alive) { setText('(오류)'); timer = setTimeout(poll, 2000); } });
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); if (child) child.kill(); };
  }, [kind, name, ver]);
  return text;
}

// ── 대역폭(bytes/s) — 선택한 토픽에 대해 rostopic/ros2 topic bw 스트림 파싱 ────────
function useBandwidth(active, ver) {
  const [bw, setBw] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active || kind !== 'topic') { setBw(''); return; }
    let alive = true, buf = '';
    const cmd = ver === '2' ? `stdbuf -oL ros2 topic bw '${name}' 2>&1` : `stdbuf -oL rostopic bw '${name}' 2>&1`;
    const child = rosSpawn(cmd);
    setBw('…');
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const ln of lines) {
        const m = ln.match(/([\d.]+\s*[KMG]?B\/s)/);   // "1.23MB/s" (ROS1) / "1.23 MB/s" (ROS2)
        if (m && alive) setBw(m[1].replace(/\s+/g, ''));
      }
    });
    child.on('error', () => { if (alive) setBw(''); });
    return () => { alive = false; try { child.kill(); } catch { /* */ } };
  }, [kind, name, ver]);
  return bw;
}

// ── 트리 만들기/펼치기 ───────────────────────────────────────────────────────
function buildTree(items) {
  const root = { name: '', path: '', children: new Map(), item: null };
  for (const it of items) {
    const parts = it.p.split('/').filter(Boolean);   // p = "topics/mavros/state" 등(카테고리 접두)
    let node = root, path = '';
    parts.forEach((part, i) => {
      path += '/' + part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map(), item: null });
      node = node.children.get(part);
      if (i === parts.length - 1) node.item = it;
    });
  }
  return root;
}
function flattenTree(node, expanded, depth, out, force) {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of kids) {
    const hasKids = c.children.size > 0;
    out.push({ node: c, depth, hasKids });
    if (hasKids && (force || expanded.has(c.path))) flattenTree(c, expanded, depth + 1, out, force);   // 검색 중엔 전부 펼침
  }
  return out;
}

function Button({ label, onPress, color = 'red' }) {
  const ref = useRef();
  const { hovering, clicking } = useOnMouseState(ref);
  useOnMouseClick(ref, (d) => { if (d) onPress(); });
  const a = hovering || clicking;
  return h(Box, { ref, borderStyle: a ? 'bold' : 'round', borderColor: a ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: a ? 'black' : 'gray', backgroundColor: a ? color : undefined, bold: a }, ` ${label} `));
}

function App() {
  const { exit } = useApp();
  const ver = useRosVersion();
  const { topics, conn } = useTopics(ver);
  const { cols, rows } = useTermSize();
  const mouse = useMouse();
  const [sel, setSel] = useState(0);
  const [top, setTop] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const [active, setActive] = useState(null);   // 오른쪽에 볼 항목(item 객체)
  const [valTop, setValTop] = useState(0);       // 오른쪽 값 패널 세로 스크롤 오프셋
  const [edit, setEdit] = useState(null);        // 파라미터 입력창 {name,value} 또는 null
  const [status, setStatus] = useState('');      // 마지막 액션 결과 메시지
  const [filter, setFilter] = useState('');      // 트리 필터 문자열('/' 검색)
  const [searching, setSearching] = useState(false);   // 검색 입력 모드
  const [frozen, setFrozen] = useState(false);   // 값 패널 프리즈(space)
  const [rateIdx, setRateIdx] = useState(() => {
    const i = RATES.indexOf(Number(process.env.RENDER_HZ));
    return i >= 0 ? i : 3;                       // 기본 10Hz
  });
  const renderHz = RATES[rateIdx];
  const capRef = useRef(100);
  capRef.current = Math.max(16, Math.round(1000 / renderHz));
  const valMaxRef = useRef(0);                    // 값 스크롤 최대치(렌더에서 갱신)
  const frozenRef = useRef(false); frozenRef.current = frozen;
  useEffect(() => { setValTop(0); setFrozen(false); }, [active && active.p]);   // 항목 바뀌면 맨 위로 + 프리즈 해제

  // Hz 히스토리(토픽별) — 스파크라인용. topics 갱신마다 링버퍼에 push.
  const hzHistRef = useRef(new Map());
  useEffect(() => {
    if (!topics) return;
    const m = hzHistRef.current;
    for (const it of topics) {
      if (it.kind !== 'topic') continue;
      const a = m.get(it.p) || [];
      a.push(it.hz || 0);
      if (a.length > 8) a.shift();
      m.set(it.p, a);
    }
  }, [topics]);

  const fullList = topics || [];
  const filt = filter.trim().toLowerCase();
  const list = filt ? fullList.filter((it) => fuzzy(filt, it.name.toLowerCase())) : fullList;
  const tree = buildTree(list);
  const flat = flattenTree(tree, expanded, 0, [], !!filt);
  const n = flat.length;
  useEffect(() => { setSel(0); setTop(0); }, [filt]);   // 필터 바뀌면 선택 맨 위로

  const VISIBLE = Math.max(3, rows - 7);   // 세로 여유(풋터 줄바꿈까지 대비) → 넘침·깜빡임 방지
  const rightW = Math.max(24, cols - LEFT_W - 5);
  const RW = rightW - 4;                    // 오른쪽 안쪽 폭(테두리2+패딩2)
  const LW = LEFT_W - 6;                    // 왼쪽 안쪽 폭(+여유2, 넓은문자 대비)

  const maxTop = Math.max(0, n - VISIBLE);
  const dsel = clamp(sel, 0, Math.max(0, n - 1));
  const dtop = clamp(top, 0, maxTop);

  const listRef = useRef();
  const listPos = useElementPosition(listRef, [topics === null]);
  const R = useRef({}); R.current = { n, dtop, listPos, VISIBLE, flat };

  const echo = useValue(active, capRef, ver, frozenRef);
  const bw = useBandwidth(active, ver);
  const activeHz = active && active.kind === 'topic' ? ((fullList.find((i) => i.p === active.p) || active).hz) : null;

  const activate = (idx) => {
    const r = R.current.flat[idx];
    if (!r) return;
    if (r.hasKids) setExpanded((s) => { const nn = new Set(s); nn.has(r.node.path) ? nn.delete(r.node.path) : nn.add(r.node.path); return nn; });
    else if (r.node.item) setActive(r.node.item);
  };
  const activateRef = useRef(activate); activateRef.current = activate;

  // 제어 액션: 선택(active) 항목에 x. param 은 입력창 오픈.
  const doAction = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const act = actionFor(ver, active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 액션 없음`); return; }
    if (act.needsInput) { setEdit({ name: active.name, value: '' }); return; }
    if (!act.cmd) { setStatus(act.label); return; }
    setStatus(`${act.label} …`);
    runAction(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const doRestart = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const act = restartFor(active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 재시작 대상 아님 (노드만)`); return; }
    setStatus(`${act.label} …`);
    runAction(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const submitSet = (name, value) => {
    const act = actionFor(ver, 'param', name, value);
    if (act && act.cmd) { setStatus(`set ${name} …`); runAction(act.cmd, (o) => setStatus(`${name} = ${value}  (${o})`)); }
  };
  const actHint = active ? ((actionFor(ver, active.kind, active.name) || {}).label || '') : '';

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    mouse.enable();
    const onScroll = (p, dir) => {
      if (dir !== 'scrolldown' && dir !== 'scrollup') return;
      const d = dir === 'scrolldown' ? 3 : -3;
      if (p && p.x > LEFT_W) setValTop((v) => clamp(v + d, 0, valMaxRef.current));   // 오른쪽 값 패널
      else setTop((t) => clamp(t + d, 0, Math.max(0, R.current.n - R.current.VISIBLE)));  // 왼쪽 트리
    };
    // 정상 클릭 = press→release 한 사이클. release 전에 또 오는 press 는 중복이므로 무시.
    // (일부 터미널/ink-mouse 가 press 를 중복 발행 → activate 두 번 → 열자마자 닫힘의 근본 원인)
    let down = false;
    const onClick = (pos, action) => {
      if (action === 'release') { down = false; return; }  // 사이클 종료
      if (action !== 'press' || down) return;               // null 무시 / release 없이 온 중복 press 무시
      down = true;
      if (pos.x > LEFT_W + 1) return;                       // 오른쪽 값 패널 클릭 무시
      const slot = pos.y - (R.current.listPos.top || 0) - 1;
      if (slot >= 0 && slot < R.current.VISIBLE) {
        const idx = R.current.dtop + slot;
        if (idx < R.current.n) { setSel(idx); activateRef.current(idx); }
      }
    };
    mouse.events.on('scroll', onScroll);
    mouse.events.on('click', onClick);
    return () => { mouse.events.off('scroll', onScroll); mouse.events.off('click', onClick); try { mouse.disable(); } catch { /* */ } };
  }, []);

  const move = (d) => {
    const ns = clamp(dsel + d, 0, Math.max(0, n - 1));
    setSel(ns);
    setTop((t) => { let nt = clamp(t, 0, maxTop); if (ns < nt) nt = ns; else if (ns >= nt + VISIBLE) nt = ns - VISIBLE + 1; return nt; });
  };
  const quit = () => { try { mouse.disable(); } catch {} exit(); };
  useInput((ch, key) => {
    if (edit) {                                          // 파라미터 입력 모드
      if (key.return) { submitSet(edit.name, edit.value); setEdit(null); }
      else if (key.escape) setEdit(null);
      else if (key.backspace || key.delete) setEdit((e) => e && ({ ...e, value: e.value.slice(0, -1) }));
      else if (ch && !key.ctrl && !key.meta) setEdit((e) => e && ({ ...e, value: e.value + ch }));
      return;
    }
    if (searching) {                                     // '/' 검색 입력 모드
      if (key.return) setSearching(false);               // 필터 유지하고 닫기
      else if (key.escape) { setSearching(false); setFilter(''); }
      else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (ch && !key.ctrl && !key.meta) setFilter((f) => f + ch);
      return;
    }
    if (ch === 'q') quit();
    else if (ch === '/') setSearching(true);             // ★ 트리 검색
    else if (ch === ' ') setFrozen((f) => !f);           // ★ 값 패널 프리즈
    else if (key.escape && filter) setFilter('');        // 필터 해제
    else if (key.downArrow || ch === 'j') move(1);
    else if (key.upArrow || ch === 'k') move(-1);
    else if (key.pageDown) move(VISIBLE);
    else if (key.pageUp) move(-VISIBLE);
    else if (key.return || key.rightArrow || ch === 'l') activate(dsel);
    else if (ch === 'x') doAction();                     // ★ 제어 액션(kill/call/set)
    else if (ch === 'r') doRestart();                    // ★ 노드 재시작
    else if (ch === 'g') { setSel(0); setTop(0); }
    else if (ch === 'G') { setSel(Math.max(0, n - 1)); setTop(maxTop); }
    else if (ch === '+' || ch === '=') setRateIdx((i) => clamp(i + 1, 0, RATES.length - 1));
    else if (ch === '-' || ch === '_') setRateIdx((i) => clamp(i - 1, 0, RATES.length - 1));
    else if (ch === ']') setValTop((v) => clamp(v + 3, 0, valMaxRef.current));
    else if (ch === '[') setValTop((v) => clamp(v - 3, 0, valMaxRef.current));
  }, { isActive: !!process.stdin.isTTY });

  if (!topics) {
    return h(Box, { borderStyle: 'round', borderColor: 'gray', paddingX: 1, width: 64, flexDirection: 'column' },
      h(Text, { bold: true, color: 'cyan' }, ' RDash '),
      h(Text, { color: 'yellow' }, !ver ? 'ROS 버전 감지 중...' : conn === 'ok' ? `ROS${ver} 노드 없음 — 노드 실행되면 자동 연결` : `ROS${ver} 연결 중...`),
      h(Text, { dimColor: true }, 'q 종료'));
  }

  // 왼쪽 트리 행
  const win = Array.from({ length: VISIBLE }, (_, i) => flat[dtop + i] || null);
  const treeRows = win.map((r, i) => {
    if (!r) return h(Box, { key: i }, h(Text, null, ' '));
    const selected = (dtop + i === dsel);
    const it = r.node.item;                       // 리프면 item(kind/name/…)
    const kind = it && it.kind;
    const isTopic = kind === 'topic';
    const live = isTopic && (it.hz || 0) > 0.1;
    const twist = r.hasKids ? (expanded.has(r.node.path) ? '▼' : '▶') : ' ';
    const mark = !it ? '' : (isTopic ? (live ? '●' : '·') : { param: 'P', service: 'S', node: 'N' }[kind] || '·');
    const nameCol = '  '.repeat(r.depth) + twist + ' ' + (it ? mark + ' ' : '') + r.node.name + (it && it.sub ? ' (sub)' : '');
    const hz = isTopic ? String(it.hz) : '';
    const spark = isTopic ? sparkline(hzHistRef.current.get(it.p), 5) : '';   // Hz 미니 히스토리
    const line = pad(nameCol, LW - 10) + pad(spark, 5) + ' ' + padL(hz, 4);
    const kindColor = { param: 'magenta', service: 'blue', node: 'green' }[kind];
    return h(Box, { key: i },
      h(Text, {
        backgroundColor: selected ? 'cyan' : undefined,
        color: selected ? 'black' : (it ? (isTopic ? (live ? undefined : 'gray') : kindColor) : 'yellow'),
        bold: selected || (r.hasKids && !it),
      }, pad(line, LW)));
  });

  // 오른쪽 값 (세로 스크롤)
  const raw = active ? echo : '  <- select a topic on the left (Enter / click)\n  expand a folder ( > ) to see its topics';
  const rawLines = raw.split('\n');
  const valMax = Math.max(0, rawLines.length - VISIBLE);
  valMaxRef.current = valMax;
  const dvalTop = clamp(valTop, 0, valMax);
  const valLines = Array.from({ length: VISIBLE }, (_, i) => pad(rawLines[dvalTop + i] ?? '', RW));
  const scrollTag = valMax > 0 ? `${dvalTop + 1}-${Math.min(rawLines.length, dvalTop + VISIBLE)}/${rawLines.length} ↕` : '';
  const titleTxt = active
    ? `${active.name} [${active.kind}]${active.kind === 'topic'
        ? ` ${activeHz != null ? activeHz : '?'}Hz${bw ? ` · ${bw}` : ''}${frozen ? ' ❄' : ''}` : ''}`
    : '(선택 없음)';

  return h(Box, { flexDirection: 'column', width: cols },
    h(Box, { flexDirection: 'row' },
      h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: LEFT_W, paddingX: 1 },
        h(Box, { justifyContent: 'space-between' },
          h(Text, { bold: true, color: 'cyan' }, ` ROS${ver || '?'} `),
          h(Text, { dimColor: true }, `${list.length}${conn === 'ok' ? '' : ' [' + conn + ']'}`)),
        h(Box, { ref: listRef, flexDirection: 'column' }, ...treeRows)),
      h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: rightW, paddingX: 1, marginLeft: 1 },
        h(Box, { justifyContent: 'space-between' },
          h(Text, { bold: true, color: 'green' }, titleTxt.slice(0, Math.max(0, RW - scrollTag.length - 1))),
          h(Text, { color: 'yellow' }, scrollTag)),
        ...valLines.map((l, i) => h(Text, { key: i, color: active ? undefined : 'gray' }, l)))),
    searching
      ? h(Box, null,
          h(Text, { color: 'yellow' }, ' 🔍 '),
          h(Text, { backgroundColor: 'yellow', color: 'black' }, `${filter} `),
          h(Text, { dimColor: true }, `  Enter=적용 Esc=취소  (${list.length}건)`))
      : edit
        ? h(Box, null,
            h(Text, { color: 'yellow' }, ` set ${edit.name} = `),
            h(Text, { backgroundColor: 'yellow', color: 'black' }, `${edit.value} `),
            h(Text, { dimColor: true }, '  Enter=적용 Esc=취소'))
        : filter
          ? h(Text, { color: 'cyan' }, ` 🔍 "${filter}" — ${list.length}건  (Esc 해제)`)
          : h(Text, { color: status ? 'cyan' : 'gray' }, status ? ` ⚑ ${status}` : (actHint ? ` x = ${actHint}` : '')),
    h(Box, null,
      h(Text, { dimColor: true }, ` ↑↓ move | Enter open | / search | x action | r restart | space freeze | [ ] value | q quit `),
      h(Button, { label: '✕ Quit', onPress: quit })));
}

// ── 대체 화면 버퍼 ───────────────────────────────────────────────────────────
const ALT_ON = '\x1b[?1049h\x1b[2J\x1b[H';
const ALT_OFF = '\x1b[?1049l';
const isTTY = !!process.stdout.isTTY;
if (isTTY) process.stdout.write(ALT_ON);
let restored = false;
const restore = () => { if (isTTY && !restored) { restored = true; process.stdout.write(ALT_OFF); } };
const { waitUntilExit } = render(h(MouseProvider, null, h(App)));
waitUntilExit().then(restore, restore);
process.on('exit', restore);
process.on('SIGTERM', () => process.exit(0));
