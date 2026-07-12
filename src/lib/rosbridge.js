// rosbridge_suite 클라이언트 — 원격 로봇의 ROS 를 websocket(rosbridge v2 프로토콜, 기본 9090)으로.
// RDash 서버가 이 클라이언트로 붙어 그래프/스트림/액션을 받아 브라우저 SSE·JSON API 로 중계한다.
// Node 22 내장 WebSocket 사용 → 무의존. 재연결·구독 ref-count·서비스 호출(promise) 지원.
export class RosbridgeClient {
  constructor(url) {
    this.url = url; this.ws = null; this.ready = false; this.idc = 0;
    this.topicCbs = new Map();   // topic → Set(cb)
    this.svcCbs = new Map();     // id → resolve
    this.q = []; this._advertised = new Set(); this._t = null;
  }

  connect() {
    try { this.ws = new WebSocket(this.url); } catch { this._retry(); return; }
    this.ws.addEventListener('open', () => { this.ready = true; for (const m of this.q) this.ws.send(m); this.q = []; });
    this.ws.addEventListener('message', (ev) => {
      let o; try { o = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      if (o.op === 'publish') { const set = this.topicCbs.get(o.topic); if (set) for (const cb of set) cb(o.msg); }
      else if (o.op === 'service_response') { const cb = this.svcCbs.get(o.id); if (cb) { this.svcCbs.delete(o.id); cb(o.result === false ? null : (o.values || {})); } }
    });
    this.ws.addEventListener('close', () => { this.ready = false; this._retry(); });
    this.ws.addEventListener('error', () => { try { this.ws.close(); } catch { /* */ } });
  }

  _retry() { if (this._t) return; this._t = setTimeout(() => { this._t = null; this.connect(); }, 1500); }
  _send(o) { const m = JSON.stringify(o); if (this.ready) { try { this.ws.send(m); } catch { this.q.push(m); } } else this.q.push(m); }

  // 토픽 구독(ref-count) — cb(msg). 반환: 구독 해제 함수.
  subscribe(topic, type, cb) {
    let set = this.topicCbs.get(topic);
    if (!set) { set = new Set(); this.topicCbs.set(topic, set); this._send({ op: 'subscribe', topic, type: type || undefined }); }
    set.add(cb);
    return () => { const s = this.topicCbs.get(topic); if (s) { s.delete(cb); if (!s.size) { this.topicCbs.delete(topic); this._send({ op: 'unsubscribe', topic }); } } };
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
