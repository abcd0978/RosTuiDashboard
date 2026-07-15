// RDash 백엔드 API 클라이언트 (TUI 용) — 계약은 API.md 참조.
// TUI 는 ROS 를 직접 만지지 않는다. 웹과 똑같이 이 API 만 쓴다 → 백엔드가 ROS 와
// 어떻게 대화하는지(cli/rcl/rosbridge)는 TUI 가 알 필요도, 알 수도 없다.
//
// HTTP: fetch(Node 18+ 내장). 스트림: /ws 멀티플렉스 하나로 전부(연결 N 개 대신 1 개).
import WebSocket from 'ws';
import { VER } from '../../../shared/ver.js';
import { webPort } from '../../../shared/ports.js';

// 백엔드 포트는 ROS 버전이 정한다(shared/ports.js) — ROS2 백엔드는 8082 라, 8080 로 박아 두면 못 붙는다.
export const API = process.env.RDASH_API || `http://127.0.0.1:${webPort(VER)}`;
const WS_URL = API.replace(/^http/, 'ws') + '/ws';

// ── HTTP ─────────────────────────────────────────────────────────────────────
// 실패해도 throw 하지 않는다 — TUI 는 백엔드가 아직 안 떴거나 rosbridge 가 끊긴 동안에도
// 계속 그려져야 한다. 호출부가 매번 try/catch 하는 대신 여기서 흡수하고 null 을 준다.
export async function api(path) {
  try {
    const r = await fetch(API + path);
    return await r.json();
  } catch { return null; }
}

export async function post(path, body) {
  try {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return await r.json();
  } catch { return null; }
}

// {out:"..."} 계열 라우트용 축약 — 실패/누락 시 빈 문자열.
export const outOf = (o) => (o && typeof o.out === 'string' ? o.out : '');

// 백엔드가 뜰 때까지 대기(index.js 가 자식으로 띄우므로 첫 몇 초는 없을 수 있다).
export async function waitForBackend(timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await api('/api/ver');
    if (v && v.ver) return v.ver;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ── /ws 멀티플렉스 ────────────────────────────────────────────────────────────
// 스트림 하나당 소켓 하나가 아니라, 소켓 하나에 id 로 다중화한다(API.md §3a).
//
// 재연결 규칙 — 오늘 rosbridge 에서 데인 그대로다:
//   · connect() 는 이미 연결 중/연결됨이면 아무것도 안 한다(중복 소켓 금지).
//   · 리스너는 자기 소켓을 캡처하고, 교체됐으면 이벤트를 무시한다(낡은 소켓의 close 가
//     새 소켓의 상태를 덮어쓰면 안 된다).
//   · 재연결되면 살아있는 구독을 전부 다시 보낸다. 서버는 우리를 기억하지 않는다.
const subs = new Map();   // id → {stream, params, onData}
let ws = null, seq = 1, ready = false, retry = null;

function sendSub(s, id) {
  ws.send(JSON.stringify({ op: 'sub', id, stream: s.stream, params: s.params || {} }));
}

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  if (retry) { clearTimeout(retry); retry = null; }
  let sock;
  try { sock = new WebSocket(WS_URL); } catch { scheduleRetry(); return; }
  ws = sock;

  sock.on('open', () => {
    if (ws !== sock) { try { sock.close(); } catch { /* */ } return; }
    ready = true;
    for (const [id, s] of subs) sendSub(s, id);   // 재연결 시 재구독 — 서버는 우리를 기억하지 않는다
  });

  sock.on('message', (raw, isBinary) => {
    if (ws !== sock) return;
    if (isBinary) return;   // 바이너리(cloudstream)는 TUI 가 쓰지 않는다
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const s = subs.get(m.i);
    if (s) s.onData(m.d);
  });

  sock.on('close', () => {
    if (ws !== sock) return;   // 낡은 소켓의 close — 새 소켓 상태를 건드리면 안 됨
    ready = false; ws = null;
    scheduleRetry();
  });

  sock.on('error', () => { try { sock.close(); } catch { /* */ } });
}

function scheduleRetry() {
  if (retry) return;
  retry = setTimeout(() => { retry = null; connect(); }, 1000);
}

// 스트림 구독. onData(line:string) — 페이로드는 API.md §3a 표 참조. 반환: 해제 함수.
export function openStream(stream, params, onData) {
  const id = seq++;
  subs.set(id, { stream, params, onData });
  connect();
  if (ready) sendSub(subs.get(id), id);
  return () => {
    subs.delete(id);
    if (ready && ws) { try { ws.send(JSON.stringify({ op: 'unsub', id })); } catch { /* */ } }
  };
}

// 인터랙티브 스트림(imstream)에 stdin 을 흘려보낸다. TUI 는 현재 안 쓰지만 계약의 일부.
export function feedStream(id, data) {
  if (ready && ws) { try { ws.send(JSON.stringify({ op: 'feed', id, data })); } catch { /* */ } }
}
