/* WS 멀티플렉스 전송 — 단일 연결로 모든 스트림. openStream(path, onData) → {close}. onData(str|ArrayBuffer).
   + 클라우드 디코드(decodeCloud). setConn 은 이 모듈의 연결 상태 표시라 여기 둔다(원래 app.js 의
   텔레메트리 섹션에 있었으나 WS 콜백에서만 쓰이므로 이동 — 동작은 동일). */

import { $ } from './dom.js';

// 클라우드 디코드 — WS 바이너리 프레임 [id(4)][mode(4)][float32 xyzc] → {arr(stride4), mode}. (레거시 base64 문자열도 허용)
export function decodeCloud(data) {
  if (data instanceof ArrayBuffer) {
    const mode = new DataView(data).getUint32(4, true);
    return { arr: new Float32Array(data, 8), mode: mode === 2 ? 'rgb' : mode === 1 ? 'intensity' : 'xyz' };
  }
  let m = 'xyz', b64 = data;
  try {
    const o = JSON.parse(data);
    if (o && o.d) { b64 = o.d; m = o.m || 'xyz'; }
  } catch (_) { /* legacy raw base64 */ }
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { arr: new Float32Array(u8.buffer), mode: m };
  } catch (_) { return null; }
}

const WS = { ws: null, seq: 1, subs: new Map(), q: [], ready: false, ever: false };

function setConn(state, label) {
  const b = $('#conn');
  if (!b) return;
  b.className = 'connbadge ' + state;
  $('#connlbl').textContent = label;
}

function wsSend(m) {
  const s = JSON.stringify(m);
  if (WS.ready && WS.ws && WS.ws.readyState === 1) WS.ws.send(s);
  else WS.q.push(s);
}

function wsConnect() {
  const w = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  w.binaryType = 'arraybuffer';
  WS.ws = w;
  w.onopen = () => {
    WS.ready = true;
    WS.ever = true;
    if (typeof setConn === 'function') setConn('ok', '연결됨');
    for (const s of WS.subs.values()) w.send(JSON.stringify({ op: 'sub', id: s.id, stream: s.stream, params: s.params }));
    const q = WS.q;
    WS.q = [];
    q.forEach((m) => w.send(m));
  };
  w.onclose = () => {
    WS.ready = false;
    if (typeof setConn === 'function') setConn(WS.ever ? 'wait' : 'bad', WS.ever ? '재연결 중…' : '연결 중…');
    setTimeout(wsConnect, 1000);
  };
  w.onerror = () => { try { w.close(); } catch (_) { /* */ } };
  w.onmessage = (e) => {
    if (typeof e.data === 'string') {
      let o;
      try { o = JSON.parse(e.data); } catch (_) { return; }
      const s = WS.subs.get(o.i);
      if (s) s.onData(o.d);
    } else {
      const s = WS.subs.get(new DataView(e.data).getUint32(0, true));
      if (s) s.onData(e.data);
    }
  };
}

// 웹소켓이 한 번이라도 열린 적 있나 — 그래프가 비었을 때 "아직 수집 중"과 "진짜로 비었음"을 구분한다.
export function wsEverOpen() {
  return WS.ever;
}

export function openStream(path, onData) {
  const qi = path.indexOf('?');
  const stream = (qi < 0 ? path : path.slice(0, qi)).replace(/^\//, '');
  const params = qi < 0 ? {} : Object.fromEntries(new URLSearchParams(path.slice(qi + 1)));
  const id = WS.seq++;
  WS.subs.set(id, { id, stream, params, onData });
  wsSend({ op: 'sub', id, stream, params });
  return {
    close() { if (WS.subs.delete(id)) wsSend({ op: 'unsub', id }); },
    feed(data) { wsSend({ op: 'feed', id, data }); },   // feed: 브리지 stdin(양방향)
  };
}

wsConnect();
