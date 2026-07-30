// rosbridge_suite 클라이언트 — 원격 로봇의 ROS 를 websocket(rosbridge v2 프로토콜, 기본 9090)으로.
// RDash 서버가 이 클라이언트로 붙어 그래프/스트림/액션을 받아 브라우저 SSE·JSON API 로 중계한다.
import WebSocket from 'ws';

// 연결 생존 확인 — half-open 소켓을 잡기 위한 값들.
// readyState 가 OPEN 인데 상대가 응답을 멈춘 상태는 close 이벤트가 오지 않는다(FIN 이 없으니 커널도 ws 도 모른다).
// 그러면 ready=true 라 503 도 안 뜨고, connect() 는 "이미 연결됨"으로 조기 리턴하고, 모든 call() 이
// 조용히 null 로 타임아웃한다 → 그래프가 빈 채로 영원히 멈춘다. 실측으로 하루 넘게 그 상태였다.
const PING_MS = 10000;          // ping 주기
const PONG_GRACE_MS = 8000;     // 마지막 트래픽 이후 이만큼 더 조용하면 죽은 것으로 본다
const CALL_FAIL_MAX = 3;        // 서비스 호출이 연속 이만큼 타임아웃하면 소켓을 버린다

// ws WebSocket 사용. 재연결·구독 ref-count·서비스 호출(promise) 지원.
export class RosbridgeClient {
  constructor(url) {
    this.url = url; this.ws = null; this.ready = false; this.idc = 0;
    this.topicCbs = new Map();   // topic → Set(cb)
    this.topicTypes = new Map(); // topic → type (재연결 시 재구독하려면 타입을 기억해야 함)
    this.svcCbs = new Map();     // id → resolve
    this.q = []; this._advertised = new Set(); this._t = null;
    this._ping = null;           // ping 인터벌 핸들
    this._aliveAt = 0;           // 마지막으로 상대가 살아있음을 확인한 시각(pong 또는 아무 메시지)
    this._fails = 0;             // 연속 call 타임아웃 횟수
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;   // 이미 연결 중/연결됨 — watchdog 이 중복 소켓을 만들지 않도록
    if (this._t) { clearTimeout(this._t); this._t = null; }   // 대기 중인 재시도 타이머 취소 — 지금 새로 연결을 시작하므로
    let sock;
    try { sock = new WebSocket(this.url); this.ws = sock; } catch { this._retry(); return; }
    sock.addEventListener('open', () => {
      if (this.ws !== sock) { try { sock.close(); } catch { /* */ } return; }   // stale 소켓의 open — 이미 새 소켓으로 교체됐으니 자신을 닫고 무시
      this.ready = true;
      this._fails = 0;
      this._startPing(sock);
      for (const [topic, type] of this.topicTypes) this.ws.send(JSON.stringify({ op: 'subscribe', topic, type: type || undefined }));   // 재연결 시 서버가 구독을 잊었으므로 재구독
      this._advertised.clear();   // 재연결 시 advertise 도 잊혔으므로 다음 publish() 가 다시 advertise 하게 비움
      for (const m of this.q) this.ws.send(m); this.q = [];
    });
    sock.addEventListener('message', (ev) => {
      if (this.ws !== sock) return;   // stale 소켓의 메시지는 무시
      this._aliveAt = Date.now();     // 어떤 메시지든 오면 상대가 살아있다는 증거
      let o; try { o = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      if (o.op === 'publish') { const set = this.topicCbs.get(o.topic); if (set) for (const cb of set) cb(o.msg); }
      else if (o.op === 'service_response') { this._fails = 0; const cb = this.svcCbs.get(o.id); if (cb) { this.svcCbs.delete(o.id); cb(o.result === false ? null : (o.values || {})); } }
    });
    sock.addEventListener('close', () => {
      if (this.ws !== sock) return;   // stale 소켓의 close — ready 를 건드리면 안 됨(새 소켓이 이미 열려 있을 수 있음)
      this._stopPing();
      this.ready = false; this.ws = null; this._retry();
    });
    sock.addEventListener('error', () => { try { sock.close(); } catch { /* */ } });
  }

  // ── 생존 확인 ─────────────────────────────────────────────────────────────
  // ws 의 ping/pong(제어 프레임)으로 상대가 실제로 반응하는지 본다. rosbridge 는 우리가 구독한 게 없으면
  // 아무것도 안 보내므로, 트래픽이 없는 것과 죽은 것을 구분할 다른 방법이 없다.
  _startPing(sock) {
    this._stopPing();
    this._aliveAt = Date.now();
    if (typeof sock.ping !== 'function') return;   // 브라우저 WebSocket 은 ping 을 노출하지 않는다 — 그땐 call 타임아웃 감지에만 의존
    sock.on('pong', () => { if (this.ws === sock) this._aliveAt = Date.now(); });
    this._ping = setInterval(() => {
      if (this.ws !== sock) { this._stopPing(); return; }
      if (Date.now() - this._aliveAt > PING_MS + PONG_GRACE_MS) { this._kill('pong 미수신'); return; }
      try { sock.ping(); } catch { this._kill('ping 전송 실패'); }
    }, PING_MS);
  }

  _stopPing() { if (this._ping) { clearInterval(this._ping); this._ping = null; } }

  // 소켓을 버리고 재연결. close 이벤트가 오지 않는 half-open 을 강제로 끊는 유일한 수단이다.
  _kill(why) {
    const sock = this.ws;
    if (!sock) return;
    this._stopPing();
    this.ready = false; this.ws = null; this._fails = 0;
    console.error(`[rosbridge] ${this.url} 연결을 버리고 재연결합니다 — ${why}`);
    try { (sock.terminate || sock.close).call(sock); } catch { /* */ }
    this._retry();
  }

  _retry() { if (this._t) return; this._t = setTimeout(() => { this._t = null; this.connect(); }, 1500); }
  _send(o) { const m = JSON.stringify(o); if (this.ready) { try { this.ws.send(m); } catch { this.q.push(m); } } else this.q.push(m); }

  // 토픽 구독(ref-count) — cb(msg). 반환: 구독 해제 함수.
  subscribe(topic, type, cb) {
    let set = this.topicCbs.get(topic);
    if (!set) { set = new Set(); this.topicCbs.set(topic, set); this.topicTypes.set(topic, type); this._send({ op: 'subscribe', topic, type: type || undefined }); }   // type 도 기억 — 재연결 open 때 재구독하려면 필요
    set.add(cb);
    return () => { const s = this.topicCbs.get(topic); if (s) { s.delete(cb); if (!s.size) { this.topicCbs.delete(topic); this.topicTypes.delete(topic); this._send({ op: 'unsubscribe', topic }); } } };
  }

  // 서비스 호출(rosapi 포함) → Promise<values|null>. 4s 타임아웃.
  call(service, args = {}) {
    return new Promise((resolve) => {
      const id = 'c' + (++this.idc); this.svcCbs.set(id, resolve);
      this._send({ op: 'call_service', service, args, id });
      setTimeout(() => {
        if (!this.svcCbs.has(id)) return;
        this.svcCbs.delete(id); resolve(null);
        // ping 은 통하는데 rosapi 만 죽는 경우(rosbridge 내부 문제)도 있다 — 연속 타임아웃을 따로 센다.
        if (++this._fails >= CALL_FAIL_MAX) this._kill(`서비스 호출 연속 ${CALL_FAIL_MAX}회 타임아웃`);
      }, 4000);
    });
  }

  publish(topic, type, msg) {
    if (!this._advertised.has(topic)) { this._advertised.add(topic); this._send({ op: 'advertise', topic, type: type || undefined }); }
    this._send({ op: 'publish', topic, msg });
  }
}

// JS 메시지 객체 → 브라우저 파서(numeric/leaves)가 읽는 yaml 유사 텍스트로. echo 표시용.
export function msgToYaml(o, ind = 0) {
  const pad = '  '.repeat(ind);
  if (o === null || typeof o !== 'object') return String(o);
  let s = '';
  for (const k in o) { const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) s += `${pad}${k}:\n${msgToYaml(v, ind + 1)}`;
    else if (Array.isArray(v)) s += `${pad}${k}: [${v.slice(0, 8).join(', ')}${v.length > 8 ? ', …' : ''}]\n`;
    else s += `${pad}${k}: ${v}\n`; }
  return s;
}

// 폼의 느슨한 flow-YAML("{linear: {x: 0}}") → JS 객체. JSON 우선, 실패 시 key 인용 후 재시도.
export function looseJson(str) {
  const s = String(str || '').trim(); if (!s) return {};
  try { return JSON.parse(s); } catch { /* */ }
  try { return JSON.parse(s.replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')); } catch { /* */ }
  return {};
}
