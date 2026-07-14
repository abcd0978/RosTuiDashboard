// rosbridge_suite 클라이언트 — 원격 로봇의 ROS 를 websocket(rosbridge v2 프로토콜, 기본 9090)으로.
// RDash 서버가 이 클라이언트로 붙어 그래프/스트림/액션을 받아 브라우저 SSE·JSON API 로 중계한다.
import WebSocket from 'ws';

// ws WebSocket 사용. 재연결·구독 ref-count·서비스 호출(promise) 지원.
export class RosbridgeClient {
  constructor(url) {
    this.url = url; this.ws = null; this.ready = false; this.idc = 0;
    this.topicCbs = new Map();   // topic → Set(cb)
    this.topicTypes = new Map(); // topic → type (재연결 시 재구독하려면 타입을 기억해야 함)
    this.svcCbs = new Map();     // id → resolve
    this.q = []; this._advertised = new Set(); this._t = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;   // 이미 연결 중/연결됨 — watchdog 이 중복 소켓을 만들지 않도록
    if (this._t) { clearTimeout(this._t); this._t = null; }   // 대기 중인 재시도 타이머 취소 — 지금 새로 연결을 시작하므로
    let sock;
    try { sock = new WebSocket(this.url); this.ws = sock; } catch { this._retry(); return; }
    sock.addEventListener('open', () => {
      if (this.ws !== sock) { try { sock.close(); } catch { /* */ } return; }   // stale 소켓의 open — 이미 새 소켓으로 교체됐으니 자신을 닫고 무시
      this.ready = true;
      for (const [topic, type] of this.topicTypes) this.ws.send(JSON.stringify({ op: 'subscribe', topic, type: type || undefined }));   // 재연결 시 서버가 구독을 잊었으므로 재구독
      this._advertised.clear();   // 재연결 시 advertise 도 잊혔으므로 다음 publish() 가 다시 advertise 하게 비움
      for (const m of this.q) this.ws.send(m); this.q = [];
    });
    sock.addEventListener('message', (ev) => {
      if (this.ws !== sock) return;   // stale 소켓의 메시지는 무시
      let o; try { o = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      if (o.op === 'publish') { const set = this.topicCbs.get(o.topic); if (set) for (const cb of set) cb(o.msg); }
      else if (o.op === 'service_response') { const cb = this.svcCbs.get(o.id); if (cb) { this.svcCbs.delete(o.id); cb(o.result === false ? null : (o.values || {})); } }
    });
    sock.addEventListener('close', () => {
      if (this.ws !== sock) return;   // stale 소켓의 close — ready 를 건드리면 안 됨(새 소켓이 이미 열려 있을 수 있음)
      this.ready = false; this.ws = null; this._retry();
    });
    sock.addEventListener('error', () => { try { sock.close(); } catch { /* */ } });
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
      setTimeout(() => { if (this.svcCbs.has(id)) { this.svcCbs.delete(id); resolve(null); } }, 4000);
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
