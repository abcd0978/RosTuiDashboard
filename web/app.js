/* RDash 웹 프론트엔드 — TUI 기능을 브라우저 GUI 로. 백엔드(web/server.js) API 를 호출/구독한다. */
'use strict';
const $ = (s) => document.querySelector(s);
const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else if (k.startsWith('on')) e[k] = a[k]; else e.setAttribute(k, a[k]); } for (const c of kids) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const api = (u, opt) => fetch(u, opt).then((r) => r.json());
const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const SNAP = location.search.includes('snap');
// 로딩 스피너 · 빈 상태 — 일관된 대기/무데이터 표현.
const spinner = (msg = '불러오는 중…') => el('div', { class: 'loading' }, el('span', { class: 'spin' }), msg);
// 클라우드 디코드 — WS 바이너리 프레임 [id(4)][mode(4)][float32 xyzc] → {arr(stride4), mode}. (레거시 base64 문자열도 허용)
function decodeCloud(data) {
  if (data instanceof ArrayBuffer) { const mode = new DataView(data).getUint32(4, true); return { arr: new Float32Array(data, 8), mode: mode === 2 ? 'rgb' : mode === 1 ? 'intensity' : 'xyz' }; }
  let m = 'xyz', b64 = data; try { const o = JSON.parse(data); if (o && o.d) { b64 = o.d; m = o.m || 'xyz'; } } catch (_) { /* legacy raw base64 */ }
  try { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return { arr: new Float32Array(u8.buffer), mode: m }; } catch (_) { return null; } }

// ── WS 멀티플렉스 전송 — 단일 연결로 모든 스트림. openStream(path, onData) → {close}. onData(str|ArrayBuffer). ──
const WS = { ws: null, seq: 1, subs: new Map(), q: [], ready: false, ever: false };
function wsSend(m) { const s = JSON.stringify(m); if (WS.ready && WS.ws && WS.ws.readyState === 1) WS.ws.send(s); else WS.q.push(s); }
function wsConnect() {
  const w = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); w.binaryType = 'arraybuffer'; WS.ws = w;
  w.onopen = () => { WS.ready = true; WS.ever = true; if (typeof setConn === 'function') setConn('ok', '연결됨'); for (const s of WS.subs.values()) w.send(JSON.stringify({ op: 'sub', id: s.id, stream: s.stream, params: s.params })); const q = WS.q; WS.q = []; q.forEach((m) => w.send(m)); };
  w.onclose = () => { WS.ready = false; if (typeof setConn === 'function') setConn(WS.ever ? 'wait' : 'bad', WS.ever ? '재연결 중…' : '연결 중…'); setTimeout(wsConnect, 1000); };
  w.onerror = () => { try { w.close(); } catch (_) { /* */ } };
  w.onmessage = (e) => { if (typeof e.data === 'string') { let o; try { o = JSON.parse(e.data); } catch (_) { return; } const s = WS.subs.get(o.i); if (s) s.onData(o.d); } else { const s = WS.subs.get(new DataView(e.data).getUint32(0, true)); if (s) s.onData(e.data); } };
}
function openStream(path, onData) {
  const qi = path.indexOf('?'); const stream = (qi < 0 ? path : path.slice(0, qi)).replace(/^\//, '');
  const params = qi < 0 ? {} : Object.fromEntries(new URLSearchParams(path.slice(qi + 1)));
  const id = WS.seq++; WS.subs.set(id, { id, stream, params, onData }); wsSend({ op: 'sub', id, stream, params });
  return { close() { if (WS.subs.delete(id)) wsSend({ op: 'unsub', id }); }, feed(data) { wsSend({ op: 'feed', id, data }); } };   // feed: 브리지 stdin(양방향)
}
wsConnect();
const emptyState = (ic, msg, sub) => el('div', { class: 'empty' }, el('div', { class: 'ic' }, ic), el('div', { class: 'msg' }, msg), sub ? el('div', { class: 'sub hint' }, sub) : document.createTextNode(''));

// ── 테마(라이트/다크) — 저장값 우선, 없으면 시스템 설정. data-theme 로 CSS 변수 전환. ──
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); const b = $('#themebtn'); if (b) { b.textContent = t === 'light' ? '☀️' : '🌙'; b.title = (t === 'light' ? '다크' : '라이트') + ' 테마로 전환'; } }
applyTheme(localStorage.getItem('rdash-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#themebtn').onclick = () => { const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; localStorage.setItem('rdash-theme', next); applyTheme(next); };
$('#wsbtn').onclick = () => { if (window.RDWorkspace) window.RDWorkspace.open(); };

let items = [], ver = '?', sel = null, selItem = null, marked = new Set();
api('/api/ver').then((o) => { ver = o.ver; $('#verlbl').textContent = 'ROS' + ver + ' · localhost'; });

// ── 시뮬레이션 시각(/clock) — 있으면 구독해 sim time 추적(rosgraph_msgs/Clock). wallclock 과 함께 표시. ──
const Clock = { sim: null, at: 0, es: null, stale() { return this.sim != null && Date.now() - this.at > 1500; } };
function ensureClock() { if (Clock.es || !items.some((i) => i.name === '/clock')) return;
  Clock.es = openStream('/echo?topic=/clock', (d) => { try { const t = JSON.parse(d); const s = /\bsec:\s*(\d+)/.exec(t), ns = /nanosec:\s*(\d+)/.exec(t); if (s) { Clock.sim = (+s[1]) + (ns ? (+ns[1]) / 1e9 : 0); Clock.at = Date.now(); } } catch (_) { /* */ } }); }
function paintClock() { const c = $('#clock'); if (!c) return; const wall = new Date().toLocaleTimeString();
  c.textContent = Clock.sim != null ? `🕒 ${wall} · sim ${Clock.sim.toFixed(1)}s${Clock.stale() ? ' ⏸' : ''}` : `🕒 ${wall}`; }
setInterval(paintClock, 500); paintClock();

// ── 텔레메트리 (WS 멀티플렉스) ───────────────────────────────────────────────
function setConn(state, label) { const b = $('#conn'); if (!b) return; b.className = 'connbadge ' + state; $('#connlbl').textContent = label; }
openStream('/events', (d) => { try { const o = JSON.parse(d); if (o.items) { items = o.items; render(); ensureClock(); } } catch (_) { /* */ } });

const nodeName = (e) => (Array.isArray(e) ? e[0] : e);
const byName = (n) => items.find((i) => i.name === n);
const topics = () => items.filter((i) => i.kind === 'topic');
const visible = () => items.filter((i) => !(i.name || '').includes('/_action/'));

// ── 노드 그래프 — rqt_graph 스타일(노드/토픽 이분 그래프) + 서비스·액션 관계 ──────────
let G = { ents: new Map(), edges: [] }, pos = new Map(), dragging = null;
const gview = { s: 1, ox: 0, oy: 0 };   // 그래프 줌/팬(#edges·#nodes 그룹 transform)
const applyGView = () => { const tr = `translate(${gview.ox},${gview.oy}) scale(${gview.s})`; const e = $('#edges'), n = $('#nodes'); if (e) e.setAttribute('transform', tr); if (n) n.setAttribute('transform', tr); };
// 화면좌표 → 그래프좌표(줌/팬 역변환).
const toGraph = (clientX, clientY) => { const rc = $('#graph').getBoundingClientRect(); return { x: (clientX - rc.left - gview.ox) / gview.s, y: (clientY - rc.top - gview.oy) / gview.s }; };
let GMODE = 'nodes';                                    // 'nodes'(노드만) | 'bipartite'(노드+토픽)
const GF = { debug: false, tf: true, services: true, actions: true, leaves: true };   // 표시 필터
const isDebug = (n) => n === '/rosout' || n === '/rosout_agg' || n === '/parameter_events';
const isTf = (n) => n === '/tf' || n === '/tf_static';
function actionGroups() {                               // 숨은 /_action/ 토픽 → 액션별 서버/클라이언트 노드
  const m = new Map();
  for (const t of items) { if (t.kind !== 'topic') continue; const mm = /^(.*)\/_action\/(feedback|status|goal|result|cancel_goal)/.exec(t.name); if (!mm) continue;
    const a = mm[1], srv = /feedback|status|result/.test(mm[2]); if (!m.has(a)) m.set(a, { servers: new Set(), clients: new Set() }); const g = m.get(a);
    (t.pubs || []).map(nodeName).forEach((p) => (srv ? g.servers : g.clients).add(p));
    (t.subs || []).map(nodeName).forEach((s) => (srv ? g.clients : g.servers).add(s)); }
  return m;
}
function buildGraph() {
  const ents = new Map(), edges = [];
  const ent = (name, type) => { if (!ents.has(name)) ents.set(name, { name, type }); };
  for (const i of items) if (i.kind === 'node') ent(i.name, 'node');
  const realTopics = items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')
    && (GF.debug || !isDebug(i.name)) && (GF.tf || !isTf(i.name)));
  if (GMODE === 'bipartite') {
    for (const t of realTopics) { const pubs = (t.pubs || []).map(nodeName), subs = (t.subs || []).map(nodeName);
      if (!GF.leaves && !(pubs.length && subs.length)) continue;
      pubs.forEach((p) => ent(p, 'node')); subs.forEach((s) => ent(s, 'node')); ent(t.name, 'topic');
      pubs.forEach((p) => edges.push({ from: p, to: t.name, kind: 'pub' }));
      subs.forEach((s) => edges.push({ from: t.name, to: s, kind: 'sub' })); }
  } else {
    const agg = new Map();
    for (const t of realTopics) { const pubs = (t.pubs || []).map(nodeName), subs = (t.subs || []).map(nodeName);
      pubs.forEach((p) => ent(p, 'node')); subs.forEach((s) => ent(s, 'node'));
      for (const p of pubs) for (const s of subs) { if (p === s) continue; const k = p + '\0' + s; if (!agg.has(k)) agg.set(k, new Set()); agg.get(k).add(t.name); } }
    for (const [k, ts] of agg) edges.push({ from: k.split('\0')[0], to: k.split('\0')[1], kind: 'topic', labels: [...ts] });
  }
  if (GF.services) for (const i of items) if (i.kind === 'service' && (i.server || []).length) {
    ent(i.name, 'service'); (i.server || []).forEach((sv) => { ent(sv, 'node'); edges.push({ from: sv, to: i.name, kind: 'service' }); }); }
  if (GF.actions) for (const [a, g] of actionGroups()) {
    ent(a, 'action'); g.servers.forEach((sv) => { ent(sv, 'node'); edges.push({ from: sv, to: a, kind: 'action' }); });
    g.clients.forEach((c) => { ent(c, 'node'); edges.push({ from: a, to: c, kind: 'action' }); }); }
  return { ents, edges };
}
function render() {
  const g = buildGraph();
  const t = items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')).length, n = items.filter((i) => i.kind === 'node').length, s = items.filter((i) => i.kind === 'service').length;
  $('#counts').textContent = `노드 ${n} · 토픽 ${t} · 서비스 ${s}`;
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600;
  for (const id of g.ents.keys()) if (!pos.has(id)) pos.set(id, { x: W / 2 + (Math.random() - .5) * 260, y: H / 2 + (Math.random() - .5) * 260, vx: 0, vy: 0 });
  for (const id of [...pos.keys()]) if (!g.ents.has(id)) pos.delete(id);
  G = g; renderSidebar(); if (activeModal) activeModal.refresh && activeModal.refresh();
}
function neighbors(id) { const s = new Set(); for (const e of G.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); } return s; }
const HALF_H = 11, GAP = 18;
function entW(name) { const e = G.ents.get(name); const base = name.replace(/^\//, '').length * 7 + 18;
  if (e && e.type === 'action') return Math.max(78, base + 24);
  if (e && e.type === 'service') return Math.max(72, base + 18);
  if (e && e.type === 'topic') return Math.max(56, base);
  return Math.max(64, base); }
const halfW = (name) => entW(name) / 2;
function borderPt(p, hw, hh, dx, dy) { const s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-6); return { x: p.x + dx * s, y: p.y + dy * s }; }
function tick() {
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600, ids = [...pos.keys()];
  // 척력(Coulomb) — 넉넉하게 밀어 노드가 서로 안 겹치게.
  for (const a of ids) { const pa = pos.get(a); for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy || 1, f = 95000 / d2, d = Math.sqrt(d2); pa.vx += dx / d * f * 0.02; pa.vy += dy / d * f * 0.02; } pa.vx += (W / 2 - pa.x) * 0.0012; pa.vy += (H / 2 - pa.y) * 0.0018; }
  // 인력(스프링) — 연결 노드는 적당한 거리로, 토픽 수(가중치)가 많을수록 살짝 더 가깝게.
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, wt = (e.labels ? e.labels.length : 1), ideal = 185 - Math.min(60, wt * 8), f = (d - ideal) * 0.009; pa.vx += dx / d * f; pa.vy += dy / d * f; pb.vx -= dx / d * f; pb.vy -= dy / d * f; }
  for (const id of ids) { const p = pos.get(id); if (dragging === id) continue; p.x += p.vx *= 0.82; p.y += p.vy *= 0.82; }
  // 충돌 해소(위치 직접 분리) — 겹치는 사각형을 침투 적은 축으로 밀어냄. 라벨 겹침도 크게 줄어듦.
  for (let it = 0; it < 2; it++) for (const a of ids) { if (dragging === a) continue; const pa = pos.get(a); for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pb.x - pa.x, dy = pb.y - pa.y; const minX = halfW(a) + halfW(b) + GAP, minY = 2 * HALF_H + GAP; const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy); if (ox > 0 && oy > 0) { if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; pa.x -= s; if (dragging !== b) pb.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; pa.y -= s; if (dragging !== b) pb.y += s; } } } }
  for (const id of ids) { const p = pos.get(id); p.x = Math.max(halfW(id) + 4, Math.min(W - halfW(id) - 4, p.x)); p.y = Math.max(HALF_H + 4, Math.min(H - HALF_H - 4, p.y)); }
  paint();
  if (!(SNAP && ++tick.n > 480)) requestAnimationFrame(tick);
}
tick.n = 0;
const NS = 'http://www.w3.org/2000/svg';
const mkSVG = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const EC = { pub: '#6fd08c', sub: '#57c7d4', service: '#6f9be0', action: '#c78ad2', topic: '#3a4658' };
function paint() {
  const eg = $('#edges'), ng = $('#nodes'); const nb = sel ? neighbors(sel) : null; eg.innerHTML = ''; ng.innerHTML = '';
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const hi = sel && (e.from === sel || e.to === sel);
    const dx = pb.x - pa.x, dy = pb.y - pa.y; const s = borderPt(pa, halfW(e.from) + 3, HALF_H + 3, dx, dy), t = borderPt(pb, halfW(e.to) + 8, HALF_H + 8, -dx, -dy);
    const ln = mkSVG('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, class: 'edge' + (hi ? ' hi' : '') });
    if (hi) { ln.style.strokeWidth = 2.4; } else { ln.style.stroke = EC[e.kind] || '#3a4658'; ln.style.strokeWidth = e.kind === 'topic' ? Math.min(5, 1.1 + e.labels.length * 0.7) : 1.5; if (e.kind === 'service') ln.style.strokeDasharray = '4 3'; }
    const ti = mkSVG('title', {}); ti.textContent = e.labels ? e.labels.join('\n') : e.kind; ln.appendChild(ti); eg.appendChild(ln);
    if (e.kind === 'topic') { const d = Math.hypot(dx, dy) || 1, mx = (s.x + t.x) / 2 - dy / d * 7, my = (s.y + t.y) / 2 + dx / d * 7;
      const tx = mkSVG('text', { x: mx, y: my + 3, 'text-anchor': 'middle', class: 'elabel' + (hi ? ' hi' : '') }); tx.textContent = e.labels.length; const t2 = mkSVG('title', {}); t2.textContent = e.labels.join('\n'); tx.appendChild(t2); eg.appendChild(tx); } }
  for (const id of pos.keys()) { const p = pos.get(id); const e = G.ents.get(id) || { type: 'node' }; const dim = sel && id !== sel && nb && !nb.has(id);
    const g = mkSVG('g', { class: 'gnode ' + e.type + (id === sel ? ' hi' : '') + (dim ? ' dim' : ''), transform: `translate(${p.x},${p.y})` });
    const label = id.replace(/^\//, ''); const w = entW(id), hw = w / 2;
    if (e.type === 'topic') g.appendChild(mkSVG('ellipse', { cx: 0, cy: 0, rx: hw, ry: 12 }));
    else if (e.type === 'service') g.appendChild(mkSVG('polygon', { points: `0,-13 ${hw},0 0,13 ${-hw},0` }));
    else if (e.type === 'action') g.appendChild(mkSVG('polygon', { points: `${-hw + 11},-12 ${hw - 11},-12 ${hw},0 ${hw - 11},12 ${-hw + 11},12 ${-hw},0` }));
    else g.appendChild(mkSVG('rect', { x: -hw, y: -11, width: w, height: 22 }));
    g.appendChild(Object.assign(mkSVG('text', { 'text-anchor': 'middle', y: 4 }), { textContent: label }));
    g.onmousedown = (ev) => { ev.stopPropagation(); dragging = id; selectNode(id); if (e.type === 'topic') selectTopic(id); const mv = (m) => { const pp = pos.get(id); const gp = toGraph(m.clientX, m.clientY); pp.x = gp.x; pp.y = gp.y; }; const up = () => { dragging = null; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); ev.preventDefault(); };
    ng.appendChild(g); }
  applyGView();
}
function selectNode(id) { sel = id; const e = G.ents.get(id); selItem = byName(id) || { kind: e ? e.type : 'node', name: id }; renderSidebar(); renderValActs(); }

// ── 사이드바 ────────────────────────────────────────────────────────────────
function renderSidebar() {
  const groups = {};
  for (const it of visible()) (groups[it.kind] || (groups[it.kind] = [])).push(it);
  const titles = { topic: '토픽', action: '액션', node: '노드', service: '서비스', param: '파라미터' };
  const H = [];
  for (const k of ['topic', 'action', 'node', 'service', 'param']) { const arr = (groups[k] || []); if (!arr.length) continue;
    H.push(el('div', { class: 'sec' }, `${titles[k] || k} (${arr.length})`));
    for (const it of arr.sort((a, b) => a.name.localeCompare(b.name))) {
      const live = it.kind === 'topic' && (it.hz > 0.1); const stale = it.kind === 'topic' && !live && it.age > 3;
      const dead = it.kind === 'topic' && it.pubs && ((it.pubs.length && !(it.subs || []).length) ? ' ⇢' : (!it.pubs.length && (it.subs || []).length ? ' ⇠' : ''));
      const row = el('div', { class: 'row' + (sel === it.name ? ' sel' : '') },
        el('span', { class: 'k-' + it.kind }, (marked.has(it.name) ? '*' : '') + it.name + (dead || '')),
        it.kind === 'topic' ? el('span', { class: 'hz ' + (live ? 'live' : stale ? 'stale' : '') }, String(it.hz ?? '')) : el('span'));
      row.onclick = () => onPick(it); H.push(row);
    } }
  const side = $('#side'); side.innerHTML = '';
  if (!H.length) { side.append(items.length ? emptyState('🔍', '표시할 항목 없음', '필터를 확인하세요') : (everOpen ? emptyState('📡', 'ROS 그래프가 비어 있음', '실행 중인 노드/토픽이 없습니다') : spinner('그래프 수집 중…'))); return; }
  H.forEach((x) => side.append(x));
}
function onPick(it) {
  sel = it.name; selItem = it; renderSidebar();
  if (it.kind === 'topic') selectTopic(it.name); else if (it.kind === 'node') { /* graph focus */ }
  renderValActs();
}

// ── 값 / 플롯 ───────────────────────────────────────────────────────────────
let echoES = null, series = {}, order = [], picked = new Set(), t0 = Date.now();
let gMin = Infinity, gMax = -Infinity, gKey = null;   // 게이지 자동 레인지(필드별)
// 오른쪽 패널에 게이지 섹션 삽입(Foxglove Gauge 패널 대응) — 첫 선택 숫자 필드의 현재값을 반원 다이얼로.
(function injectGauge() { const r = $('#right'); if (!r) return; r.append(el('div', { class: 'sec' }, '게이지 (첫 선택 필드)'), el('div', { class: 'box' }, el('canvas', { id: 'gauge', width: 300, height: 120 }))); })();
// 그래프 컨트롤 바(rqt_graph 스타일 옵션) — 뷰 모드 토글 + 표시 필터.
(function injectGraphControls() {
  const main = document.querySelector('main'); if (!main) return;
  const bar = el('div', { id: 'gctrl' });
  const seg = el('span', { class: 'seg' });
  const bN = el('button', { class: 'on' }, '노드'), bB = el('button', {}, '노드+토픽');
  const setMode = (m) => { GMODE = m; bN.className = m === 'nodes' ? 'on' : ''; bB.className = m === 'bipartite' ? 'on' : ''; pos.clear(); render(); };
  bN.onclick = () => setMode('nodes'); bB.onclick = () => setMode('bipartite'); seg.append(bN, bB);
  const chk = (key, label, init) => { const c = el('input', { type: 'checkbox' }); c.checked = init; c.onchange = () => { GF[key] = c.checked; render(); }; return el('label', {}, c, label); };
  bar.append(seg, chk('services', '서비스', true), chk('actions', '액션', true), chk('tf', 'tf', true), chk('debug', 'debug', false), chk('leaves', 'dead-end', true));
  main.appendChild(bar);
})();
function drawGauge() {
  const cv = $('#gauge'); if (!cv) return; const ctx = cv.getContext('2d'); const W = cv.width = cv.clientWidth, H = cv.height; ctx.clearRect(0, 0, W, H);
  const k = [...picked][0]; if (!k || !series[k] || !series[k].length) { ctx.fillStyle = '#8b97a7'; ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText('숫자 필드 선택 시 게이지', W / 2, H / 2); return; }
  if (k !== gKey) { gKey = k; gMin = Infinity; gMax = -Infinity; }   // 게이지 필드가 바뀌면 레인지 리셋
  const v = series[k][series[k].length - 1][1]; gMin = Math.min(gMin, v); gMax = Math.max(gMax, v); let lo = gMin, hi = gMax; if (hi - lo < 1e-6) { hi = lo + 1; lo -= 1; }
  const frac = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); const cx = W / 2, cy = H - 22, r = Math.min(W / 2 - 14, H - 34);
  ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.strokeStyle = '#232b36'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = frac > 0.85 ? '#e06a6a' : frac > 0.6 ? '#e2c85a' : '#57c7d4'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + frac * Math.PI); ctx.stroke();
  ctx.fillStyle = '#d5dae2'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText(v.toFixed(3), cx, cy - 6);
  ctx.fillStyle = '#8b97a7'; ctx.font = '10px monospace'; ctx.fillText(k, cx, cy + 12); ctx.textAlign = 'left'; ctx.fillText(lo.toFixed(1), cx - r - 2, cy + 14); ctx.textAlign = 'right'; ctx.fillText(hi.toFixed(1), cx + r + 2, cy + 14);
}
function numeric(text) { const out = {}; const stack = []; for (const raw of text.split('\n')) { if (!raw.trim() || raw.trim() === '---') continue; const ind = raw.length - raw.trimStart().length; const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/); if (!m) continue; const key = m[1], val = m[2].trim(); while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop(); const path = [...stack.map((s) => s.key), key].join('.'); if (val === '') { stack.push({ ind, key }); continue; } if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) out[path] = parseFloat(val); } return out; }
// 모든 스칼라 리프(문자/불리언/enum 포함) — State Transitions 용. {path, val(문자열)} 목록.
function leaves(text) { const out = []; const stack = []; for (const raw of text.split('\n')) { if (!raw.trim() || raw.trim() === '---') continue; const ind = raw.length - raw.trimStart().length; const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/); if (!m) continue; const key = m[1], val = m[2].trim(); while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop(); const path = [...stack.map((s) => s.key), key].join('.'); if (val === '') { stack.push({ ind, key }); continue; } out.push({ path, val: val.replace(/^['"]|['"]$/g, '') }); } return out; }
function selectTopic(name) {
  $('#valtitle').textContent = name; sel = name; renderSidebar(); renderValActs();
  if (echoES) echoES.close(); series = {}; order = []; picked = new Set(); t0 = Date.now(); gMin = Infinity; gMax = -Infinity; gKey = null; $('#fields').innerHTML = '';
  echoES = openStream('/echo?topic=' + encodeURIComponent(name), (d) => { const text = JSON.parse(d); $('#val').textContent = text.slice(0, 1500);
    const nums = numeric(text), t = (Date.now() - t0) / 1000;
    for (const [k, v] of Object.entries(nums)) { if (!series[k]) { series[k] = []; order.push(k); if (picked.size < 2) picked.add(k); renderFields(); } series[k].push([t, v]); if (series[k].length > 600) series[k].shift(); }
    drawPlot(); drawGauge(); });
}
function renderValActs() {
  const box = $('#valacts'); box.innerHTML = ''; const it = selItem; if (!it) return;
  const add = (label, fn) => box.append(el('button', { class: 'act', onclick: fn }, label));
  if (it.kind === 'topic') { add('publish', () => Views.publish(it)); add('states', () => Views.states(it));
    if ((it.ty || '').includes('NavSatFix')) add('🗺 map', () => Views.map(it));
    if ((it.ty || '').includes('CompressedImage') || (it.ty || '').includes('sensor_msgs/msg/Image')) add('🖼 image', () => Views.image(it));
    if ((it.ty || '').includes('PointCloud2') || /visualization_msgs\/(msg\/)?Marker(Array)?/.test(it.ty || '')) add('🧊 3D', () => Views.cloud(it));
    add('msg def', () => Views.msgdef(it)); add('QoS', () => Views.qos(it)); add('connections', () => Views.connections(it)); add(marked.has(it.name) ? 'unmark' : 'mark', () => { marked.has(it.name) ? marked.delete(it.name) : marked.add(it.name); renderSidebar(); renderValActs(); }); }
  if (it.kind === 'service') add('call', () => Views.service(it));
  if (it.kind === 'param') add('set', () => Views.setparam(it));
  if (it.kind === 'node') { add('params', () => Views.params(it)); add('kill', () => post('/api/killnode', { name: it.name }).then((r) => toast(r.out))); add('restart', () => post('/api/restart', { name: it.name }).then((r) => toast(r.out))); add('lifecycle', () => Views.lifecycle(it)); add('connections', () => Views.connections(it)); }
  if (it.kind === 'action') add('send goal', () => Views.action(it));
}
function renderFields() { const f = $('#fields'); f.innerHTML = ''; order.forEach((k) => { const c = el('input', { type: 'checkbox', 'data-k': k }); c.checked = picked.has(k); c.onchange = () => { c.checked ? picked.add(k) : picked.delete(k); drawPlot(); }; f.append(el('label', {}, c, k)); }); }
function drawPlot() { const cv = $('#plot'), ctx = cv.getContext('2d'); const W = cv.width = cv.clientWidth, Hh = cv.height; ctx.clearRect(0, 0, W, Hh); const keys = [...picked].filter((k) => series[k] && series[k].length > 1); if (!keys.length) return; let mn = Infinity, mx = -Infinity, tmin = Infinity, tmax = -Infinity; for (const k of keys) for (const [t, v] of series[k]) { if (v < mn) mn = v; if (v > mx) mx = v; if (t < tmin) tmin = t; if (t > tmax) tmax = t; } if (mx - mn < 1e-9) { mx += 1; mn -= 1; } const cols = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2']; keys.forEach((k, ci) => { ctx.strokeStyle = cols[ci % cols.length]; ctx.lineWidth = 1.4; ctx.beginPath(); series[k].forEach(([t, v], i) => { const x = (t - tmin) / (tmax - tmin || 1) * (W - 8) + 4, y = Hh - 6 - (v - mn) / (mx - mn) * (Hh - 14); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.fillStyle = cols[ci % cols.length]; ctx.fillText(k, 6, 12 + ci * 12); }); }

// ── Doctor(헬스 스캔) — src/lib/doctor.js 와 동일 규칙을 브라우저에서 ──────────────
const SEV = ['ERROR', 'WARN', 'INFO'];
function diagnose(list) {
  const out = []; const tp = list.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/'));
  const rel = (e) => (Array.isArray(e) ? e[1] : null), dur = (e) => (Array.isArray(e) ? e[2] : null), nm = (e) => (Array.isArray(e) ? e[0] : e);
  for (const t of tp) { const pubs = t.pubs || [], subs = t.subs || [];
    if (pubs.some((p) => rel(p) === 'B') && subs.some((s) => rel(s) === 'R')) out.push({ sev: 0, target: t.name, msg: 'QoS 불일치: BEST_EFFORT 발행 → RELIABLE 구독자는 수신 못 함' });
    if (pubs.some((p) => dur(p) === 'V') && subs.some((s) => dur(s) === 'T')) out.push({ sev: 1, target: t.name, msg: 'QoS durability: VOLATILE 발행 → TRANSIENT_LOCAL 구독자는 초기값 못 받음' });
    if (pubs.length && !subs.length) out.push({ sev: 2, target: t.name, msg: '구독자 없음 — ' + pubs.map(nm).join(', ') + ' 가 아무도 안 듣는 토픽 발행' });
    if (subs.length && !pubs.length) out.push({ sev: 1, target: t.name, msg: '발행자 없음 — ' + subs.map(nm).join(', ') + ' 가 오지 않는 데이터를 대기' });
    if (pubs.length && typeof t.age === 'number' && t.age > 5) out.push({ sev: 1, target: t.name, msg: 'stale ' + t.age.toFixed(1) + 's — 발행자 있으나 값이 끊김' });
  }
  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  const counts = { ERROR: 0, WARN: 0, INFO: 0 }; out.forEach((o) => counts[SEV[o.sev]]++);
  return { issues: out, counts, scanned: { nodes: list.filter((i) => i.kind === 'node').length, topics: tp.length } };
}

// ── Baseline/회귀 — src/lib/baseline.js 와 동일 규칙(브라우저) ───────────────────
function snapProfile(list) {
  const nodes = list.filter((i) => i.kind === 'node').map((i) => i.name).sort();
  const services = list.filter((i) => i.kind === 'service').map((i) => i.name).sort();
  const topics = {}; list.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/')).forEach((t) => { topics[t.name] = { hz: t.hz || 0, ty: t.ty || '' }; });
  return { at: 0, nodes, topics, services };
}
function diffBaseline(base, list, hzTol = 0.3) {
  const out = []; if (!base) return out; const now = snapProfile(list);
  const bn = new Set(base.nodes || []), nn = new Set(now.nodes);
  (base.nodes || []).forEach((n) => { if (!nn.has(n)) out.push({ sev: 0, target: n, msg: '노드 사라짐 (기준선엔 있었음)' }); });
  now.nodes.forEach((n) => { if (!bn.has(n)) out.push({ sev: 2, target: n, msg: '노드 추가됨 (기준선엔 없음)' }); });
  const bt = base.topics || {};
  for (const t in bt) if (!(t in now.topics)) out.push({ sev: 1, target: t, msg: '토픽 사라짐 (기준선엔 있었음)' });
  for (const t in now.topics) if (!(t in bt)) out.push({ sev: 2, target: t, msg: '토픽 추가됨 (기준선엔 없음)' });
  for (const t in bt) if (t in now.topics) { const b = bt[t].hz, c = now.topics[t].hz; if (b > 0.5) { const dr = (c - b) / b; if (Math.abs(dr) > hzTol) out.push({ sev: dr < 0 ? 1 : 2, target: t, msg: `Hz ${b.toFixed(1)}→${c.toFixed(1)} (${dr > 0 ? '+' : ''}${(dr * 100).toFixed(0)}%)` }); } }
  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  return out;
}

// ── 🔴 트리거 녹화 — 조건 발생 시 자동 캡처. 무장은 모달을 닫아도 유지(전역 컨트롤러) ──
const Trigger = { armed: false, cond: 'graph', last: 0, es: null, iv: null, log: [], onchange: null };
function trigBadge() { let b = $('#trigbadge'); if (!b) { b = el('span', { id: 'trigbadge', class: 's', style: 'color:var(--red);font-weight:600' }); $('#counts').after(b); } b.textContent = Trigger.armed ? '  🔴 TRIG' : ''; if (Trigger.onchange) Trigger.onchange(); }
function trigFire(reason) { const now = Date.now(); if (now - Trigger.last < 30000) return; Trigger.last = now; post('/api/record', {}).then((r) => { Trigger.log.unshift(`${new Date(now).toLocaleTimeString()} · ${reason} → rosbag job ${r.id || '?'}`); if (Trigger.log.length > 30) Trigger.log.pop(); trigBadge(); }); }
function trigDisarm() { Trigger.armed = false; if (Trigger.es) { Trigger.es.close(); Trigger.es = null; } if (Trigger.iv) { clearInterval(Trigger.iv); Trigger.iv = null; } trigBadge(); }
function trigArm(cond) { trigDisarm(); Trigger.armed = true; Trigger.cond = cond; Trigger.last = 0;
  if (cond === 'diag') { Trigger.es = openStream('/diagnostics', (d) => { try { if (/level:\s*2/.test(JSON.parse(d))) trigFire('/diagnostics ERROR'); } catch (_) { /* */ } }); }
  else { Trigger.iv = setInterval(() => { const errs = diagnose(items).issues.filter((i) => i.sev === 0); if (errs.length) trigFire('그래프 ERROR: ' + errs[0].target); }, 2000); }
  trigBadge();
}

// ── WebGL 3D 씬 렌더러 — 그리드·좌표축·TF 프레임·Marker(큐브/구/실린더/화살표/라인/텍스트)·포인트클라우드 + 투명도 ──
// 점/선/삼각형을 pos(vec3)+col(vec4) 한 셰이더로 그린다. 불투명→선→점→반투명(깊이쓰기 off) 순서로 블렌딩.
const qrot = (q, v) => { const x = q[0], y = q[1], z = q[2], w = q[3], a = v[0], b = v[1], c = v[2]; const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a); return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)]; };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
// 열-우선 4x4 역행렬(gluInvertMatrix) — 화면 클릭 → 월드 광선 언프로젝트(그라운드 픽킹)용.
function inv16(m) { const o = new Array(16);
  o[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  o[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  o[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  o[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  o[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  o[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  o[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  o[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  o[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  o[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  o[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  o[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  o[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  o[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  o[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  o[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * o[0] + m[1] * o[4] + m[2] * o[8] + m[3] * o[12]; if (!det) return null; det = 1 / det;
  for (let i = 0; i < 16; i++) o[i] *= det; return o; }
function mkScene(cv, labelDiv, info) {
  const gl = cv.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: SNAP }) || cv.getContext('experimental-webgl');
  if (!gl) { info.textContent = 'WebGL 미지원 브라우저'; return { setCloud() {}, setMarkers() {}, setCloudById() {}, setMarkersById() {}, setVisible() {}, removeDisplay() {}, setTF() {}, opts() {}, view() {}, setPointSize() {}, setPickHandler() {}, setCamImage() {}, setCamOpts() {}, clearCamera() {}, setInteractiveMarkers() {}, setImHandler() {}, getStats() { return { fps: 0, points: 0, drawn: 0 }; }, dispose() {} }; }
  const VS = 'attribute vec3 p; attribute vec4 col; uniform mat4 mvp; uniform float psize; varying vec4 vc; void main(){ gl_Position = mvp*vec4(p,1.0); gl_PointSize = psize; vc = col; }';
  const FS = 'precision mediump float; varying vec4 vc; uniform float round; void main(){ if(round>0.5){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; } gl_FragColor = vc; }';
  // 클라우드 전용 셰이더 — xyz 만 올리고 높이색을 GPU(FS)에서 계산: 점당 JS 색 루프 제거 + 버퍼 절반(3f vs 7f).
  // 거리 LOD(GPU): lodDist 너머는 keep=lodDist/depth 비율만 유지(위치 해시로 안정, 깜빡임 없음) + 생존점을 1/√keep 로
  // 키워 밀도 보존. CPU 재정렬 불필요 → 전량 무복사 업로드. (참고: Gaussian-splat 뷰어의 거리 LOD 기법을 점군에 적용.)
  const VSC = 'attribute vec3 p; attribute float c; uniform mat4 mvp; uniform mat4 world; uniform float psize; uniform float lodDist; varying float vz; varying float vc;'
    + ' void main(){ vec4 wp = world*vec4(p,1.0); vec4 clip = mvp*wp; float depth = clip.w; float ps = psize;'
    + ' if(lodDist>0.0 && depth>lodDist){ float keep=max(lodDist/depth,0.04); float h=fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);'
    + ' if(h>keep){ gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=0.0; return; } ps = psize/sqrt(keep); }'
    + ' gl_Position = clip; gl_PointSize = ps; vz = wp.z; vc = c; }';
  // 색상 모드: 0=높이(z) · 1=intensity(jet) · 2=rgb(패킹 언팩) · 3=단색.
  const FSC = 'precision mediump float; varying float vz; varying float vc; uniform float zmin, zmax, round, colorMode, cmin, cmax;'
    + ' void main(){ if(round>0.5){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; } vec3 col;'
    + ' if(colorMode<0.5){ float h=clamp((vz-zmin)/max(zmax-zmin,1e-4),0.0,1.0); col=vec3(0.2+h*0.7,0.66+h*0.14,0.87-h*0.55); }'
    + ' else if(colorMode<1.5){ float h=clamp((vc-cmin)/max(cmax-cmin,1e-4),0.0,1.0); col=vec3(clamp(1.5-abs(4.0*h-3.0),0.0,1.0),clamp(1.5-abs(4.0*h-2.0),0.0,1.0),clamp(1.5-abs(4.0*h-1.0),0.0,1.0)); }'
    + ' else if(colorMode<2.5){ float b=mod(vc,256.0); float g=mod(floor(vc/256.0),256.0); float r=floor(vc/65536.0); col=vec3(r,g,b)/255.0; }'
    + ' else { col=vec3(0.55,0.7,0.85); } gl_FragColor=vec4(col,1.0); }';
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(o)); return o; };
  const mkProg = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
  const prog = mkProg(VS, FS); gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'p'), aC = gl.getAttribLocation(prog, 'col'), uMVP = gl.getUniformLocation(prog, 'mvp'), uPS = gl.getUniformLocation(prog, 'psize'), uRound = gl.getUniformLocation(prog, 'round');
  const cprog = mkProg(VSC, FSC);
  const caP = gl.getAttribLocation(cprog, 'p'), caC = gl.getAttribLocation(cprog, 'c'), cuMVP = gl.getUniformLocation(cprog, 'mvp'), cuWorld = gl.getUniformLocation(cprog, 'world'), cuPS = gl.getUniformLocation(cprog, 'psize'), cuZmin = gl.getUniformLocation(cprog, 'zmin'), cuZmax = gl.getUniformLocation(cprog, 'zmax'), cuLod = gl.getUniformLocation(cprog, 'lodDist'), cuRound = gl.getUniformLocation(cprog, 'round'), cuCM = gl.getUniformLocation(cprog, 'colorMode'), cuCmin = gl.getUniformLocation(cprog, 'cmin'), cuCmax = gl.getUniformLocation(cprog, 'cmax');
  const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const gMat4 = () => { const g = computeG(); if (!g) return IDENT16; const q = g.q, x = q[0], y = q[1], z = q[2], w = q[3], xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0, 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0, 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0, g.p[0], g.p[1], g.p[2], 1]; };
  gl.enableVertexAttribArray(caC);
  // 텍스처 프로그램 — 카메라 이미지 3D 투영(광학 프레임에 FOV 크기 텍스처 쿼드).
  const tprog = mkProg('attribute vec3 p; attribute vec2 uv; uniform mat4 mvp; varying vec2 vuv; void main(){ gl_Position = mvp*vec4(p,1.0); vuv = uv; }',
    'precision mediump float; varying vec2 vuv; uniform sampler2D tex; uniform float alpha; void main(){ gl_FragColor = vec4(texture2D(tex, vuv).rgb, alpha); }');
  const taP = gl.getAttribLocation(tprog, 'p'), taUV = gl.getAttribLocation(tprog, 'uv'), tuMVP = gl.getUniformLocation(tprog, 'mvp'), tuTex = gl.getUniformLocation(tprog, 'tex'), tuAlpha = gl.getUniformLocation(tprog, 'alpha');
  const camTex = gl.createTexture(), camBuf = gl.createBuffer(); const camState = { on: false, ready: false, W: 640, H: 480, fx: 500, fy: 500, frame: '', dist: 2, alpha: 1 };
  gl.enableVertexAttribArray(aP); gl.enableVertexAttribArray(aC);
  gl.clearColor(0.043, 0.055, 0.071, 1); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const bufs = { pts: gl.createBuffer(), line: gl.createBuffer(), tri: gl.createBuffer(), triA: gl.createBuffer() };
  const data = { pts: new Float32Array(0), line: new Float32Array(0), tri: new Float32Array(0), triA: new Float32Array(0) };
  const nV = { pts: 0, line: 0, tri: 0, triA: 0 };
  const upload = (k, arr) => { data[k] = arr; nV[k] = arr.length / 7 | 0; gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW); };
  const cloudBuf = gl.createBuffer(); let cloudN = 0, zmin = 0, zmax = 1, cmin = 0, cmax = 1;   // 클라우드 xyzc 버퍼 + z/c 범위 유니폼
  const permCache = { n: -1, perm: null };   // 거리 LOD 순열 캐시(점수 바뀔 때만 재계산)
  let yaw = 0.7, pitch = -0.6, dist = 12, center = [0, 0, 0.5], psize = 2.4, pan = [0, 0], raf = 0, alive = true;
  // 최적화 옵션(선택 가능) — lodMode: off|distance|adaptive · lodDist: 거리 임계(월드) · targetFps: 적응형 목표 ·
  // maxPoints: 하드 상한(0=무제한) · round: 둥근 점(off=사각, 소프트웨어에서 더 빠름).
  const opt = { grid: true, axes: true, lodMode: 'adaptive', lodDist: 60, targetFps: 40, maxPoints: 0, round: true, colorMode: 0, follow: null, ortho: false, fixedFrame: null };
  let frames = [], labels = [], frameMap = {};   // frameMap: frame_id → 루트 기준 {p,q}
  // 고정 프레임 변환 g(루트→고정): 고정 프레임의 역변환. null=identity.
  const computeG = () => { const F = opt.fixedFrame && frameMap[opt.fixedFrame]; if (!F) return null; const cq = [-F.q[0], -F.q[1], -F.q[2], F.q[3]]; const pg = qrot(cq, F.p); return { q: cq, p: [-pg[0], -pg[1], -pg[2]] }; };
  const applyG = (g, r) => { if (!g) return r; const v = qrot(g.q, r); return [v[0] + g.p[0], v[1] + g.p[1], v[2] + g.p[2]]; };
  const labelPool = [];          // 라벨 span 재사용(프레임마다 DOM 재생성 방지)
  const clouds = new Map();      // 디스플레이 id → {data:Float32Array(xyz), visible} — 여러 클라우드 동시 렌더
  const markerSets = new Map();  // 디스플레이 id → {markers:[], visible}
  const ims = new Map();         // 인터랙티브 마커 name → {frame_id, pose, scale, visual[], handles[], visible}
  let imDrag = null, imHandler = null, imFeedT = 0;   // 6-DOF 드래그 상태 · 피드백 콜백 · 스로틀
  let fps = 0, lastDrawn = 0, frameN = 0, fpsClock = (typeof performance !== 'undefined' ? performance.now() : 0);
  const gcd = (a, b) => { while (b) { const t = b; b = a % b; a = t; } return a; };
  // prefix 가 공간적으로 대표성 있도록 큰 서로소 곱 순열(거리 LOD 로 앞쪽 N개만 그려도 골고루).
  const stridePermute = (n) => { const idx = new Uint32Array(n); if (!n) return idx; let step = (Math.floor(n * 0.6180339887) | 1); while (gcd(step, n) !== 1) step++; for (let k = 0, j = 0; k < n; k++, j = (j + step) % n) idx[k] = j; return idx; };
  const perspective = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; };
  const mul = (a, b) => { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const orthoM = (r, t, n, f) => { const nf = 1 / (n - f); return [1 / r, 0, 0, 0, 0, 1 / t, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (f + n) * nf, 1]; };
  function mvpMat() { const asp = (cv.clientWidth || 900) / (cv.clientHeight || 520); const P = opt.ortho ? orthoM(dist * asp * 0.5, dist * 0.5, 0.05, 5000) : perspective(45 * Math.PI / 180, asp, 0.05, 5000);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Ry = [cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], Rp = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -center[0] + pan[0], -center[1], -center[2] + pan[1], 1], V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1];
    return mul(P, mul(V, mul(Rp, mul(Ry, T)))); }
  // 화면 클릭 → 그라운드(z=0) 평면 교점(월드). 3D 툴(Publish/Nav Goal/측정)용.
  function pickGround(cx, cy) { const rect = cv.getBoundingClientRect(); const W = cv.clientWidth, H = cv.clientHeight;
    const nx = (cx - rect.left) / W * 2 - 1, ny = -((cy - rect.top) / H * 2 - 1); const inv = inv16(mvpMat()); if (!inv) return null;
    const un = (z) => { const w = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15]; return [(inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12]) / w, (inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13]) / w, (inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14]) / w]; };
    const a = un(-1), b = un(1); const dz = b[2] - a[2]; if (Math.abs(dz) < 1e-9) return null; const t = -a[2] / dz; if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]; }
  // ── 지오메트리 빌더(로컬 좌표 → pose(q,p) 적용, 스케일은 생성 시 반영) ──
  const xf = (po, v) => { const r = qrot(po.q, v); return [r[0] + po.p[0], r[1] + po.p[1], r[2] + po.p[2]]; };
  const put = (A, p, c) => { A.push(p[0], p[1], p[2], c[0], c[1], c[2], c[3]); };
  const tri = (A, po, a, b, c, col) => { put(A, xf(po, a), col); put(A, xf(po, b), col); put(A, xf(po, c), col); };
  const line = (A, po, a, b, col) => { put(A, xf(po, a), col); put(A, xf(po, b), col); };
  const BOXV = [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]];
  const BOXF = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [0, 3, 5], [0, 5, 4], [1, 7, 6], [1, 6, 2], [3, 2, 6], [3, 6, 5], [0, 4, 7], [0, 7, 1]];
  function box(A, po, s, col) { const h = [s[0] / 2, s[1] / 2, s[2] / 2]; for (const f of BOXF) tri(A, po, [BOXV[f[0]][0] * h[0], BOXV[f[0]][1] * h[1], BOXV[f[0]][2] * h[2]], [BOXV[f[1]][0] * h[0], BOXV[f[1]][1] * h[1], BOXV[f[1]][2] * h[2]], [BOXV[f[2]][0] * h[0], BOXV[f[2]][1] * h[1], BOXV[f[2]][2] * h[2]], col); }
  function sphere(A, po, s, col, seg) { seg = seg || 10; const rx = s[0] / 2, ry = s[1] / 2, rz = s[2] / 2; const P = (u, v) => [rx * Math.sin(v) * Math.cos(u), ry * Math.sin(v) * Math.sin(u), rz * Math.cos(v)];
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) { const u0 = i / seg * 2 * Math.PI, u1 = (i + 1) / seg * 2 * Math.PI, v0 = j / seg * Math.PI, v1 = (j + 1) / seg * Math.PI; tri(A, po, P(u0, v0), P(u1, v0), P(u1, v1), col); tri(A, po, P(u0, v0), P(u1, v1), P(u0, v1), col); } }
  function cyl(A, po, s, col, seg) { seg = seg || 16; const rx = s[0] / 2, ry = s[1] / 2, hz = s[2] / 2; const C = (a, z) => [rx * Math.cos(a), ry * Math.sin(a), z];
    for (let i = 0; i < seg; i++) { const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI; tri(A, po, C(a0, -hz), C(a1, -hz), C(a1, hz), col); tri(A, po, C(a0, -hz), C(a1, hz), C(a0, hz), col); tri(A, po, [0, 0, hz], C(a0, hz), C(a1, hz), col); tri(A, po, [0, 0, -hz], C(a1, -hz), C(a0, -hz), col); } }
  function arrow(A, po, s, col, seg) { seg = seg || 12; const L = s[0] || 1, rs = (s[1] || 0.1) / 2, rh = (s[2] || 0.2) / 2, sl = L * 0.72; const C = (a, x, r) => [x, r * Math.cos(a), r * Math.sin(a)];
    for (let i = 0; i < seg; i++) { const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI; tri(A, po, C(a0, 0, rs), C(a1, 0, rs), C(a1, sl, rs), col); tri(A, po, C(a0, 0, rs), C(a1, sl, rs), C(a0, sl, rs), col); tri(A, po, [L, 0, 0], C(a0, sl, rh), C(a1, sl, rh), col); } }
  // ── 6-DOF 인터랙티브 마커 — 프레임/월드 변환, 화면투영, 레이, 축/링 드래그 수학 ──
  const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
  const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
  const frameW = (fid) => { let q = [0, 0, 0, 1], p = [0, 0, 0]; const fr = fid && frameMap[fid]; if (fr) { q = fr.q; p = fr.p; } const g = computeG(); if (g) { q = qmul(g.q, q); p = applyG(g, p); } return { q, p }; };
  const imWorld = (im) => { const W = frameW(im.frame_id), lp = im.pose.p, lq = im.pose.q, wp = qrot(W.q, lp); return { q: qmul(W.q, lq), p: [wp[0] + W.p[0], wp[1] + W.p[1], wp[2] + W.p[2]] }; };
  const imLocal = (im, wq, wp) => { const W = frameW(im.frame_id), cq = qconj(W.q); return { q: qmul(cq, wq), p: qrot(cq, [wp[0] - W.p[0], wp[1] - W.p[1], wp[2] - W.p[2]]) }; };
  const screenOf = (w) => { const m = mvpMat(), x = w[0], y = w[1], z = w[2], cw = m[3] * x + m[7] * y + m[11] * z + m[15]; if (cw <= 1e-6) return null; return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * cv.clientWidth, (-(m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5) * cv.clientHeight]; };
  const screenRay = (cx, cy) => { const rect = cv.getBoundingClientRect(), nx = (cx - rect.left) / cv.clientWidth * 2 - 1, ny = -((cy - rect.top) / cv.clientHeight * 2 - 1), inv = inv16(mvpMat()); if (!inv) return null;
    const un = (zz) => { const w = inv[3] * nx + inv[7] * ny + inv[11] * zz + inv[15]; return [(inv[0] * nx + inv[4] * ny + inv[8] * zz + inv[12]) / w, (inv[1] * nx + inv[5] * ny + inv[9] * zz + inv[13]) / w, (inv[2] * nx + inv[6] * ny + inv[10] * zz + inv[14]) / w]; }; const a = un(-1), b = un(1); return { o: a, d: v3.sub(b, a) }; };
  const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
  const axisColor = (ax) => { const a = [Math.abs(ax[0]), Math.abs(ax[1]), Math.abs(ax[2])]; if (a[0] >= a[1] && a[0] >= a[2]) return [0.95, 0.4, 0.4, 1]; if (a[1] >= a[2]) return [0.45, 0.9, 0.5, 1]; return [0.45, 0.6, 1, 1]; };
  const ringBasis = (N) => { const e1 = v3.norm(Math.abs(N[2]) < 0.9 ? v3.cross(N, [0, 0, 1]) : v3.cross(N, [1, 0, 0])); return [e1, v3.cross(N, e1)]; };
  // 레이(O,D)에 가장 가까운 축선(P0+A t)의 파라미터 t — 축 이동 드래그.
  const axisParam = (P0, A, O, D) => { const w0 = v3.sub(P0, O), a = v3.dot(A, A), b = v3.dot(A, D), c = v3.dot(D, D), d = v3.dot(A, w0), e = v3.dot(D, w0), den = a * c - b * b; return Math.abs(den) < 1e-9 ? d / a : (b * e - c * d) / den; };
  // 중심 C, 법선 N 평면에 레이 투영 → 링 위 각도(회전 드래그).
  const ringAngle = (C, N, ray) => { const dn = v3.dot(N, ray.d); if (Math.abs(dn) < 1e-9) return 0; const u = v3.dot(N, v3.sub(C, ray.o)) / dn, hit = v3.add(ray.o, v3.scale(ray.d, u)), vec = v3.sub(hit, C), be = ringBasis(N); return Math.atan2(v3.dot(vec, be[1]), v3.dot(vec, be[0])); };
  function pickIm(cx, cy) { let best = null, bestD = 14;   // (cx,cy: 캔버스 상대) 화면상 핸들 최근접 히트테스트
    for (const im of ims.values()) { if (!im.visible || !(im.handles && im.handles.length)) continue; const w = imWorld(im), s = (im.scale || 1) * 0.9;
      for (const h of im.handles) { const ax = v3.norm(qrot(w.q, h.axis));
        if (h.mode === 'move') { const a = screenOf(v3.add(w.p, v3.scale(ax, s))), b = screenOf(v3.sub(w.p, v3.scale(ax, s))); if (!a || !b) continue; const dd = segDist(cx, cy, a[0], a[1], b[0], b[1]); if (dd < bestD) { bestD = dd; best = { im, h }; } }
        else { const bs = ringBasis(ax), R = s * 0.85; let md = 1e9; for (let i = 0; i < 28; i++) { const t = i / 28 * 2 * Math.PI, pnt = screenOf(v3.add(w.p, v3.add(v3.scale(bs[0], R * Math.cos(t)), v3.scale(bs[1], R * Math.sin(t))))); if (pnt) { const q = Math.hypot(cx - pnt[0], cy - pnt[1]); if (q < md) md = q; } } if (md < bestD) { bestD = md; best = { im, h }; } } } }
    return best; }
  function startImDrag(hit, e) { const w = imWorld(hit.im), axW = v3.norm(qrot(w.q, hit.h.axis)), ray = screenRay(e.clientX, e.clientY);
    const st = { im: hit.im, h: hit.h, axW, startWorld: { q: w.q.slice(), p: w.p.slice() } };
    if (hit.h.mode === 'move') st.t0 = ray ? axisParam(w.p, axW, ray.o, ray.d) : 0; else st.ang0 = ray ? ringAngle(w.p, axW, ray) : 0;
    if (imHandler) imHandler(hit.im.name, hit.im.pose, 'mouse_down', hit.h.name); return st; }
  function updateImDrag(e) { const st = imDrag, ray = screenRay(e.clientX, e.clientY); if (!ray) return; let wp = st.startWorld.p, wq = st.startWorld.q;
    if (st.h.mode === 'move') { const t = axisParam(st.startWorld.p, st.axW, ray.o, ray.d); wp = v3.add(st.startWorld.p, v3.scale(st.axW, t - st.t0)); }
    else { const dA = ringAngle(st.startWorld.p, st.axW, ray) - st.ang0, hh = dA / 2, sn = Math.sin(hh); wq = qmul([st.axW[0] * sn, st.axW[1] * sn, st.axW[2] * sn, Math.cos(hh)], st.startWorld.q); }
    st.im.pose = imLocal(st.im, wq, wp); rebuildScene();
    const now = (typeof performance !== 'undefined' ? performance.now() : 0); if (imHandler && now - imFeedT > 40) { imFeedT = now; imHandler(st.im.name, st.im.pose, 'pose_update', st.h.name); } }
  function finishImDrag() { if (imDrag && imHandler) imHandler(imDrag.im.name, imDrag.im.pose, 'mouse_up', imDrag.h.name); }
  // 씬 지오메트리(그리드·좌표축·TF·마커)만 재구성 — 마커/TF/opts 변경 시에만 호출(클라우드와 분리).
  function rebuildScene() {
    const L = [], T = [], TA = [], Pc = []; labels = [];
    if (opt.grid) { const g = 8; for (let i = -g; i <= g; i++) { const c = [0.22, 0.27, 0.34, 1]; put(L, [i, -g, 0], c); put(L, [i, g, 0], c); put(L, [-g, i, 0], c); put(L, [g, i, 0], c); } }
    if (opt.axes) { const O = { q: [0, 0, 0, 1], p: [0, 0, 0] }; line(L, O, [0, 0, 0], [1.2, 0, 0], [0.9, 0.35, 0.35, 1]); line(L, O, [0, 0, 0], [0, 1.2, 0], [0.44, 0.82, 0.55, 1]); line(L, O, [0, 0, 0], [0, 0, 1.2], [0.4, 0.6, 0.95, 1]); }
    frameMap = {}; for (const f of frames) frameMap[f.id] = { p: f.p || [0, 0, 0], q: f.q || [0, 0, 0, 1] };
    const g = computeG();
    for (const f of frames) { let po = { q: f.q || [0, 0, 0, 1], p: f.p || [0, 0, 0] }; if (g) po = { q: qmul(g.q, po.q), p: applyG(g, po.p) }; line(L, po, [0, 0, 0], [0.3, 0, 0], [0.9, 0.35, 0.35, 1]); line(L, po, [0, 0, 0], [0, 0.3, 0], [0.44, 0.82, 0.55, 1]); line(L, po, [0, 0, 0], [0, 0, 0.3], [0.4, 0.6, 0.95, 1]); labels.push({ p: po.p, t: f.id, c: '#9aa7b8' }); }
    // frame_id → 루트 기준 변환(TF), 이후 고정 프레임 g 적용. 마커/디스플레이를 해당 프레임에 배치(RViz 식).
    for (const set of markerSets.values()) { if (!set.visible) continue; for (const m of set.markers) { if (m.action === 2 || m.action === 3) continue;
      let po = { q: (m.pose && m.pose.q) || [0, 0, 0, 1], p: (m.pose && m.pose.p) || [0, 0, 0] };
      const fr = m.frame_id && frameMap[m.frame_id]; if (fr) { const wp = qrot(fr.q, po.p); po = { q: qmul(fr.q, po.q), p: [wp[0] + fr.p[0], wp[1] + fr.p[1], wp[2] + fr.p[2]] }; }
      if (g) po = { q: qmul(g.q, po.q), p: applyG(g, po.p) };
      const col = m.color && m.color.length === 4 ? m.color : [0.6, 0.8, 0.9, 1]; const A = col[3] < 0.99 ? TA : T; const s = m.scale || [1, 1, 1]; const pts = m.points || [];
      if (m.type === 1) box(A, po, s, col);
      else if (m.type === 2) sphere(A, po, s, col);
      else if (m.type === 3) cyl(A, po, s, col);
      else if (m.type === 0) arrow(A, po, s, col);
      else if (m.type === 6) pts.forEach((q, i) => box(A, { q: po.q, p: xf(po, q) }, s, (m.colors[i] || col)));
      else if (m.type === 7) pts.forEach((q, i) => sphere(A, { q: po.q, p: xf(po, q) }, s, (m.colors[i] || col)));
      else if (m.type === 4) { for (let i = 0; i + 1 < pts.length; i++) line(L, po, pts[i], pts[i + 1], col); }
      else if (m.type === 5) { for (let i = 0; i + 1 < pts.length; i += 2) line(L, po, pts[i], pts[i + 1], col); }
      else if (m.type === 8) pts.forEach((q, i) => put(Pc, xf(po, q), (m.colors[i] || col)));
      else if (m.type === 11) { for (let i = 0; i + 2 < pts.length; i += 3) tri(A, po, pts[i], pts[i + 1], pts[i + 2], (m.colors[i / 3 | 0] || col)); }
      else if (m.type === 9) labels.push({ p: po.p, t: m.text, c: `rgb(${col[0] * 255 | 0},${col[1] * 255 | 0},${col[2] * 255 | 0})` }); } }
    // ── 인터랙티브 마커 — 비주얼 지오메트리 + 6-DOF 기즈모(이동 화살표선 · 회전 링) ──
    for (const im of ims.values()) { if (!im.visible) continue; const w = imWorld(im), base = { q: w.q, p: w.p }, O0 = { q: [0, 0, 0, 1], p: [0, 0, 0] };
      for (const m of (im.visual || [])) { const po = { q: qmul(w.q, (m.pose && m.pose.q) || [0, 0, 0, 1]), p: xf(base, (m.pose && m.pose.p) || [0, 0, 0]) };
        const col = m.color && m.color.length === 4 ? m.color : [0.5, 0.7, 0.9, 1]; const A = col[3] < 0.99 ? TA : T; const s = m.scale || [1, 1, 1], pts = m.points || [];
        if (m.type === 1) box(A, po, s, col); else if (m.type === 2) sphere(A, po, s, col); else if (m.type === 3) cyl(A, po, s, col); else if (m.type === 0) arrow(A, po, s, col);
        else if (m.type === 4) { for (let i = 0; i + 1 < pts.length; i++) line(L, po, pts[i], pts[i + 1], col); }
        else if (m.type === 5) { for (let i = 0; i + 1 < pts.length; i += 2) line(L, po, pts[i], pts[i + 1], col); }
        else if (m.type === 11) { for (let i = 0; i + 2 < pts.length; i += 3) tri(A, po, pts[i], pts[i + 1], pts[i + 2], col); }
        else if (m.type === 8) pts.forEach((qp) => put(Pc, xf(po, qp), col)); }
      const s = (im.scale || 1) * 0.9;
      for (const h of (im.handles || [])) { const ax = v3.norm(qrot(w.q, h.axis)); const hot = imDrag && imDrag.im === im && imDrag.h === h; const c = hot ? [1, 0.9, 0.3, 1] : axisColor(h.axis);
        if (h.mode === 'move') { line(L, O0, v3.add(w.p, v3.scale(ax, s)), v3.sub(w.p, v3.scale(ax, s)), c); box(T, { q: w.q, p: v3.add(w.p, v3.scale(ax, s)) }, [s * 0.09, s * 0.09, s * 0.09], c); }
        else { const bs = ringBasis(ax), R = s * 0.85; let prev = null; for (let i = 0; i <= 40; i++) { const t = i / 40 * 2 * Math.PI, pnt = v3.add(w.p, v3.add(v3.scale(bs[0], R * Math.cos(t)), v3.scale(bs[1], R * Math.sin(t)))); if (prev) line(L, O0, prev, pnt, c); prev = pnt; } } }
      labels.push({ p: [w.p[0], w.p[1], w.p[2] + s * 1.15], t: im.name, c: '#c8d2df' }); }
    upload('line', new Float32Array(L)); upload('tri', new Float32Array(T)); upload('triA', new Float32Array(TA));
    upload('pts', new Float32Array(Pc));   // 마커 POINTS(항상 그림, 소량)
  }
  // 클라우드만 업로드 — 점당 (x,y,z,c) stride4. 보이는 디스플레이 병합(단일이면 복사 없음) → xyzc 버퍼. 색은 GPU.
  function uploadCloud() {
    const vis = []; let total = 0; for (const c of clouds.values()) if (c.visible && c.data.length) { vis.push(c.data); total += (c.data.length / 4 | 0); }
    cloudN = total; if (!total) { gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW); return; }
    const src = vis.length === 1 ? vis[0] : (() => { const m = new Float32Array(total * 4); let o = 0; for (const a of vis) { m.set(a, o); o += a.length; } return m; })();
    let mn = Infinity, mx = -Infinity, cn = Infinity, cx = -Infinity; for (let i = 0; i < total; i++) { const z = src[i * 4 + 2], cc = src[i * 4 + 3]; if (z < mn) mn = z; if (z > mx) mx = z; if (cc < cn) cn = cc; if (cc > cx) cx = cc; } zmin = mn; zmax = mx; cmin = cn; cmax = cx;
    let out;
    // 거리 LOD 는 셰이더가 처리 → 보통은 무복사 업로드. 하드 상한(maxPoints)이 걸릴 때만 대표성 순열로 프리픽스 샘플.
    if (opt.maxPoints > 0 && opt.maxPoints < total) { if (permCache.n !== total) { permCache.perm = stridePermute(total); permCache.n = total; } const perm = permCache.perm; out = new Float32Array(total * 4); for (let k = 0; k < total; k++) { const i = perm[k]; out[k * 4] = src[i * 4]; out[k * 4 + 1] = src[i * 4 + 1]; out[k * 4 + 2] = src[i * 4 + 2]; out[k * 4 + 3] = src[i * 4 + 3]; } }
    else out = src;
    gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf); gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
  }
  function bind(k) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 28, 12); }
  function projectLabels(mvp) { if (!labelDiv) return; const W = cv.clientWidth, H = cv.clientHeight; let u = 0;
    for (const l of labels) { const x = l.p[0], y = l.p[1], z = l.p[2]; const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12], cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13], cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15]; if (cw <= 0) continue; const sx = (cx / cw * 0.5 + 0.5) * W, sy = (-cy / cw * 0.5 + 0.5) * H;
      let sp = labelPool[u]; if (!sp) { sp = document.createElement('span'); sp.style.cssText = 'position:absolute;font:11px monospace;transform:translate(-50%,-50%);pointer-events:none;text-shadow:0 0 3px #0d1116'; labelDiv.append(sp); labelPool.push(sp); }
      sp.style.display = ''; sp.textContent = l.t; sp.style.left = sx + 'px'; sp.style.top = sy + 'px'; sp.style.color = l.c; u++; }
    for (let i = u; i < labelPool.length; i++) labelPool[i].style.display = 'none'; }
  function draw() { const W = cv.clientWidth || 900, H = cv.clientHeight || 520; if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
    if (opt.follow && frameMap[opt.follow]) center = applyG(computeG(), frameMap[opt.follow].p);   // 프레임 추종: 카메라 중심 = 그 프레임 위치
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = mvpMat(), mvpF = new Float32Array(mvp);
    gl.useProgram(prog); gl.uniformMatrix4fv(uMVP, false, mvpF); gl.uniform1f(uRound, 0); gl.depthMask(true);
    if (nV.tri) { bind('tri'); gl.drawArrays(gl.TRIANGLES, 0, nV.tri); }
    if (nV.line) { bind('line'); gl.drawArrays(gl.LINES, 0, nV.line); }
    if (nV.pts) { gl.uniform1f(uPS, psize); gl.uniform1f(uRound, 1); bind('pts'); gl.drawArrays(gl.POINTS, 0, nV.pts); gl.uniform1f(uRound, 0); }
    // 클라우드 — 전용 셰이더(GPU 높이색) + 거리 LOD(멀수록 앞쪽 일부만, 순열로 대표성 유지).
    if (cloudN) { gl.useProgram(cprog); gl.uniformMatrix4fv(cuMVP, false, mvpF); gl.uniformMatrix4fv(cuWorld, false, new Float32Array(gMat4())); gl.uniform1f(cuPS, psize); gl.uniform1f(cuZmin, zmin); gl.uniform1f(cuZmax, zmax);
      gl.uniform1f(cuLod, opt.lodMode === 'off' ? 0 : opt.lodDist); gl.uniform1f(cuRound, opt.round ? 1 : 0); gl.uniform1f(cuCM, opt.colorMode); gl.uniform1f(cuCmin, cmin); gl.uniform1f(cuCmax, cmax);
      gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf); gl.vertexAttribPointer(caP, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(caC, 1, gl.FLOAT, false, 16, 12);
      const dc = opt.maxPoints > 0 ? Math.min(cloudN, opt.maxPoints) : cloudN; lastDrawn = dc;   // 셰이더가 거리 LOD 로 추가 컬링
      gl.drawArrays(gl.POINTS, 0, dc); gl.useProgram(prog); } else lastDrawn = 0;
    if (nV.triA) { gl.depthMask(false); bind('triA'); gl.drawArrays(gl.TRIANGLES, 0, nV.triA); gl.depthMask(true); }
    // 카메라 이미지 3D 투영 — 광학 프레임에 FOV 크기 텍스처 쿼드(카메라 프레임 TF ∘ 고정프레임 g).
    if (camState.on && camState.ready) { const fr = frameMap[camState.frame], g = computeG(); const d = camState.dist, hw = d * (camState.W / 2) / camState.fx, hh = d * (camState.H / 2) / camState.fy;
      const loc = [[-hw, -hh, d, 0, 0], [hw, -hh, d, 1, 0], [hw, hh, d, 1, 1], [-hw, -hh, d, 0, 0], [hw, hh, d, 1, 1], [-hw, hh, d, 0, 1]]; const vd = [];
      for (const c of loc) { let pt = [c[0], c[1], c[2]]; if (fr) { const r = qrot(fr.q, pt); pt = [r[0] + fr.p[0], r[1] + fr.p[1], r[2] + fr.p[2]]; } if (g) pt = applyG(g, pt); vd.push(pt[0], pt[1], pt[2], c[3], c[4]); }
      gl.useProgram(tprog); gl.uniformMatrix4fv(tuMVP, false, mvpF); gl.uniform1f(tuAlpha, camState.alpha); gl.uniform1i(tuTex, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, camBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vd), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(taP, 3, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(taUV, 2, gl.FLOAT, false, 20, 12);
      gl.depthMask(camState.alpha > 0.99); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.depthMask(true); gl.useProgram(prog); }
    projectLabels(mvp);
    frameN++; const now = (typeof performance !== 'undefined' ? performance.now() : fpsClock + 16); if (now - fpsClock >= 500) { fps = Math.round(frameN * 1000 / (now - fpsClock)); frameN = 0; fpsClock = now;
      // 적응형 LOD — FPS 가 목표보다 낮으면 거리 임계(lodDist)를 낮춰 먼 점을 더 솎고, 여유 있으면 높여 디테일 복원.
      if (opt.lodMode === 'adaptive' && cloudN) { if (fps < opt.targetFps - 5) opt.lodDist = Math.max(3, opt.lodDist * 0.85); else if (fps > opt.targetFps + 8) opt.lodDist = Math.min(200, opt.lodDist * 1.12); } } }
  let drag = null, btn = 0, pickHandler = null;
  cv.addEventListener('mousedown', (e) => { if (pickHandler && e.button === 0) { const w = pickGround(e.clientX, e.clientY); if (w) { pickHandler(w, e); e.preventDefault(); return; } }
    if (e.button === 0 && ims.size) { const rect = cv.getBoundingClientRect(); const hit = pickIm(e.clientX - rect.left, e.clientY - rect.top); if (hit) { imDrag = startImDrag(hit, e); rebuildScene(); cv.style.cursor = 'grabbing'; e.preventDefault(); return; } }
    drag = { x: e.clientX, y: e.clientY }; btn = e.button; cv.style.cursor = 'grabbing'; e.preventDefault(); });
  window.addEventListener('mouseup', () => { if (imDrag) { finishImDrag(); imDrag = null; rebuildScene(); } drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mousemove', (e) => { if (imDrag) { updateImDrag(e); return; } if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (btn === 2) { pan[0] += dx * dist * 0.002; pan[1] -= dy * dist * 0.002; } else { yaw += dx * 0.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * 0.01)); } });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dist *= e.deltaY < 0 ? 0.9 : 1.1; }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  rebuildScene();   // 그리드·좌표축을 데이터 도착 전에도 표시
  function loop() { if (!alive) return; draw(); if (!(SNAP && ++loop.n > 300)) raf = requestAnimationFrame(loop); }
  loop.n = 0; loop();
  return {
    // 기본(단일) 디스플레이 — 하위호환. id 판(setCloudById/…)은 RViz 식 다중 디스플레이용.
    // 클라우드 setter 는 uploadCloud 만(씬 지오메트리 재구성 없음) → 고빈도 프레임 최적화.
    setCloud(f) { if (f && f.length) { const ex = clouds.get('_'); clouds.set('_', { data: f, visible: ex ? ex.visible : true }); } else clouds.delete('_'); uploadCloud(); },
    setMarkers(m) { const ex = markerSets.get('_'); markerSets.set('_', { markers: m || [], visible: ex ? ex.visible : true }); rebuildScene(); },
    setCloudById(id, f) { if (f && f.length) { const ex = clouds.get(id); clouds.set(id, { data: f, visible: ex ? ex.visible : true }); } else clouds.delete(id); uploadCloud(); },
    setMarkersById(id, m) { const ex = markerSets.get(id); markerSets.set(id, { markers: m || [], visible: ex ? ex.visible : true }); rebuildScene(); },
    setVisible(kind, id, on) { const map = kind === 'cloud' ? clouds : markerSets; const d = map.get(id); if (d) { d.visible = !!on; kind === 'cloud' ? uploadCloud() : rebuildScene(); } },
    removeDisplay(kind, id) { (kind === 'cloud' ? clouds : markerSets).delete(id); kind === 'cloud' ? uploadCloud() : rebuildScene(); },
    setTF(f) { frames = f || []; rebuildScene(); },
    opts(o) { Object.assign(opt, o); rebuildScene(); },
    view(p) { pan = [0, 0]; if (p === 'top') { yaw = 0; pitch = -1.554; } else if (p === 'front') { yaw = 0; pitch = 0; } else if (p === 'side') { yaw = Math.PI / 2; pitch = 0; } else if (p === 'back') { yaw = Math.PI; pitch = 0; } else { yaw = 0.7; pitch = -0.6; dist = 12; center = [0, 0, 0.5]; } },
    setPointSize(s) { psize = s; },
    setPickHandler(fn) { pickHandler = fn; cv.style.cursor = fn ? 'crosshair' : 'grab'; },
    setCamImage(imgEl, cam, frame) { if (!imgEl || !cam || !cam.K) return; camState.W = cam.width || imgEl.naturalWidth || 640; camState.H = cam.height || imgEl.naturalHeight || 480; camState.fx = cam.K[0] || 500; camState.fy = cam.K[4] || 500; camState.frame = frame || cam.frame_id || ''; camState.on = true;
      gl.bindTexture(gl.TEXTURE_2D, camTex); try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgEl); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); camState.ready = true; } catch (_) { /* */ } },
    setCamOpts(o) { Object.assign(camState, o); },
    clearCamera() { camState.on = false; camState.ready = false; },
    setInteractiveMarkers(list) { ims.clear(); for (const im of (list || [])) if (im && im.name) ims.set(im.name, { ...im, visible: true }); rebuildScene(); },
    setImHandler(fn) { imHandler = fn; },
    getStats() { return { fps, points: cloudN, drawn: lastDrawn, lodDist: opt.lodDist, lodMode: opt.lodMode }; },
    dispose() { alive = false; cancelAnimationFrame(raf); if (labelDiv) labelDiv.innerHTML = ''; try { for (const k in bufs) gl.deleteBuffer(bufs[k]); gl.deleteBuffer(cloudBuf); gl.deleteProgram(prog); gl.deleteProgram(cprog); } catch (_) { /* */ } },
  };
}

// ── 모달 ───────────────────────────────────────────────────────────────────
let activeModal = null;
function openModal(title, node, refresh) { $('#mtitle').textContent = title; const b = $('#mbody'); b.innerHTML = ''; b.append(node); $('#modal').classList.add('on'); activeModal = { refresh, close: () => {} }; }
function closeModal() { $('#modal').classList.remove('on'); if (activeModal && activeModal.close) { try { activeModal.close(); } catch (_) { /* */ } } if (modalSub) { modalSub.close(); modalSub = null; } activeModal = null; }
let modalSub = null;   // 모달이 연 SSE
// 토스트 — 우하단에 뜨는 알림(레벨: ok/warn/err/info). 연결 배지를 덮어쓰지 않는다.
function toast(msg, level = 'info') { const wrap = $('#toasts'); if (!wrap) return;
  const ICON = { ok: '✓', warn: '▲', err: '✕', info: 'ℹ' };
  const t = el('div', { class: 'toast ' + level }, el('span', { class: 'ti', style: 'color:var(--' + ({ ok: 'green', warn: 'yellow', err: 'red', info: 'cyan' }[level]) + ')' }, ICON[level] || 'ℹ'), el('span', {}, String(msg)));
  wrap.append(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 3200); }

// ── 뷰들 ───────────────────────────────────────────────────────────────────
const Views = {
  async msgdef(it) { const pre = el('pre', { class: 'out' }, spinner('메시지 정의 조회 중…')); openModal('📄 ' + (it.ty || it.name), pre); const r = await api('/api/msgdef?type=' + encodeURIComponent(it.ty || '')); pre.textContent = r.out || ''; if (!r.out) { pre.textContent = ''; pre.append(emptyState('📭', '메시지 정의 없음', (it.ty || '') + ' 타입 정보를 가져올 수 없습니다')); } },
  qos(it) {
    const t = byName(it.name) || it; const pubs = t.pubs || [], subs = t.subs || [];
    const REL = (r) => (r === 'R' ? 'RELIABLE' : r === 'B' ? 'BEST_EFFORT' : '?'), DUR = (d) => (d === 'T' ? 'TRANSIENT_LOCAL' : d === 'V' ? 'VOLATILE' : '?');
    const mismatch = pubs.some((p) => p[1] === 'B') && subs.some((s) => s[1] === 'R');
    const tbl = el('table', { class: 'tbl' }); tbl.append(el('tr', {}, el('th', {}, '역할'), el('th', {}, '노드'), el('th', {}, 'reliability'), el('th', {}, 'durability')));
    pubs.forEach((p) => tbl.append(el('tr', {}, el('td', {}, 'pub'), el('td', {}, p[0]), el('td', {}, REL(p[1])), el('td', {}, DUR(p[2])))));
    subs.forEach((p) => tbl.append(el('tr', {}, el('td', {}, 'sub'), el('td', {}, p[0]), el('td', {}, REL(p[1])), el('td', {}, DUR(p[2])))));
    const warn = el('p', { style: 'color:' + (mismatch ? 'var(--red)' : 'var(--green)') }, mismatch ? '⚠ reliability 불일치 — RELIABLE 구독자는 BEST_EFFORT 발행자 메시지를 못 받습니다' : '✓ reliability 호환');
    openModal('🔌 QoS — ' + it.name, el('div', {}, tbl, warn));
  },
  async connections(it) { const pre = el('pre', { class: 'out' }, spinner('연결 관계 조회 중…')); openModal('🔗 ' + it.name, pre); const r = await api(`/api/connections?kind=${it.kind}&name=${encodeURIComponent(it.name)}`); pre.textContent = r.out || ''; if (!r.out) { pre.append(emptyState('🔗', '연결 정보 없음')); } },
  async tftree() { const pre = el('pre', { class: 'out' }, spinner('/tf 수집 중…')); openModal('🌳 TF tree', pre); const r = await api('/api/tftree'); pre.textContent = r.out || ''; if (!(r.out || '').trim()) { pre.append(emptyState('🌳', 'TF 프레임 없음', '/tf 토픽에서 변환을 받지 못했습니다')); } },
  publish(it) { this._msgForm('▲ publish — ' + it.name, '/api/publish', { name: it.name }, 'msg', '/api/proto?name=' + encodeURIComponent(it.name) + '&type=' + encodeURIComponent(it.ty || '')); },
  service(it) { this._msgForm('call service — ' + it.name, '/api/service', { name: it.name }, 'req'); },
  action(it) { const ta = el('textarea', { rows: 4, style: 'width:100%', html: '{}' }); const out = el('pre', { class: 'out' }); const btn = el('button', { class: 'act', onclick: async () => { const r = await post('/api/action', { name: it.name, type: it.ty || '', goal: ta.value }); out.textContent = 'goal 전송 (job ' + r.id + ') — Jobs 에서 피드백'; } }, 'send goal'); openModal('🎯 action goal — ' + it.name, el('div', {}, el('div', { class: 'hint' }, 'goal (YAML)'), ta, el('div', { class: 'actbtns' }, btn), out)); },
  _msgForm(title, url, base, key, protoUrl) { const ta = el('textarea', { rows: 5, style: 'width:100%', html: '{}' }); const out = el('pre', { class: 'out' }); const btn = el('button', { class: 'act', onclick: async () => { out.textContent = '전송 중…'; const r = await post(url, { ...base, [key]: ta.value }); out.textContent = r.out; } }, '전송'); openModal(title, el('div', {}, el('div', { class: 'hint' }, key + ' (YAML/JSON)'), ta, el('div', { class: 'actbtns' }, btn), out)); if (protoUrl) api(protoUrl).then((r) => { if (r && r.yaml && ta.value.trim() === '{}') ta.value = r.yaml; }).catch(() => {}); },
  setparam(it) { const inp = el('input', { style: 'width:100%', value: '' }); const out = el('pre', { class: 'out' }); openModal('set param — ' + it.name, el('div', {}, inp, el('div', { class: 'actbtns' }, el('button', { class: 'act', onclick: async () => { const r = await post('/api/setparam1', { name: it.name, value: inp.value }); out.textContent = r.out; } }, '적용')), out)); },
  async params(it) {
    const wrap = el('div', {}, spinner('파라미터 조회 중…')); openModal('⚙ params — ' + it.name, wrap);
    const r = await api('/api/param/list?node=' + encodeURIComponent(it.name)); wrap.innerHTML = '';
    if (!r.rows || !r.rows.length) { wrap.append(emptyState('⚙', '파라미터 없음', it.name + ' 노드에 선언된 파라미터가 없습니다')); return; }
    const tbl = el('table', { class: 'tbl' }); tbl.append(el('tr', {}, el('th', {}, 'parameter'), el('th', {}, 'value'), el('th', {}, '')));
    for (const row of r.rows) { const val = el('input', { value: row.value, style: 'width:120px' }); const cell = el('td', {}, val);
      const setb = el('button', { class: 'act', onclick: async () => { const rr = await post('/api/param/set', { node: it.name, name: row.name, value: val.value }); val.value = rr.value; } }, 'set');
      tbl.append(el('tr', {}, el('td', {}, row.name), cell, el('td', {}, setb))); }
    wrap.append(tbl);
  },
  lifecycle(it) { const box = el('div', { class: 'actbtns' }); const out = el('pre', { class: 'out' }); ['configure', 'activate', 'deactivate', 'cleanup', 'shutdown'].forEach((tr) => box.append(el('button', { class: 'act', onclick: async () => { const r = await post('/api/lifecycle', { node: it.name, transition: tr }); out.textContent = r.out; } }, tr))); openModal('♻ lifecycle — ' + it.name, el('div', {}, box, out)); },
  stream(title, endpoint, parse, klass) {
    const filterInp = el('input', { placeholder: '필터…', style: 'margin-bottom:6px' });
    const tbl = el('table', { class: 'tbl' }); const wrap = el('div', {}, filterInp, tbl); openModal(title, wrap);
    const rows = []; const rerender = () => { const f = filterInp.value.toLowerCase(); tbl.innerHTML = ''; rows.filter((r) => !f || r.text.toLowerCase().includes(f)).slice(-400).forEach((r) => tbl.append(el('tr', { class: 'lrow ' + r.cls }, el('td', {}, r.a), el('td', {}, r.b)))); wrap.scrollTop = wrap.scrollHeight; };
    filterInp.oninput = rerender;
    modalSub = openStream(endpoint, (d) => { const blk = JSON.parse(d); for (const r of parse(blk)) { rows.push(r); if (rows.length > 1000) rows.shift(); } rerender(); });
  },
  log() { const L = (l) => (l >= 50 ? 'FATAL' : l >= 40 ? 'ERROR' : l >= 30 ? 'WARN' : l >= 20 ? 'INFO' : 'DEBUG'), C = (l) => (l >= 40 ? 'ERROR' : l >= 30 ? 'WARN' : 'OK'); this.stream('📜 로그 /rosout', '/rosout', (blk) => { const lv = /level:\s*(\d+)/.exec(blk), nm = /name:\s*["']?([^\n"']+)/.exec(blk), ms = /msg:\s*["']?(.*)/.exec(blk); const lvl = lv ? +lv[1] : 0; return [{ a: L(lvl), b: (nm ? nm[1].trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), cls: C(lvl), text: blk }]; }); },
  diag() { const LV = ['OK', 'WARN', 'ERROR', 'STALE']; this.stream('🩺 진단 /diagnostics', '/diagnostics', (blk) => { const out = []; const si = blk.indexOf('status:'); const sb = si >= 0 ? blk.slice(si) : blk; for (const part of sb.split(/\n\s*- /).slice(1)) { const lv = /level:\s*(\d+)/.exec(part), nm = /name:\s*["']?(.*)/.exec(part), ms = /message:\s*["']?(.*)/.exec(part); const lvl = lv ? +lv[1] : 0; out.push({ a: LV[lvl] || '?', b: (nm ? nm[1].replace(/["']\s*$/, '').trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), cls: LV[lvl] || 'OK', text: part }); } return out; }); },
  doctor() {
    const wrap = el('div', {}); openModal('🩺 Doctor — 시스템 건강', wrap, () => {});
    const draw = () => { const { issues, counts, scanned } = diagnose(items); wrap.innerHTML = '';
      const clr = ['var(--red)', 'var(--yellow)', 'var(--dim)'], mark = ['●', '▲', 'ℹ'];
      wrap.append(el('div', { class: 'hint', style: 'margin-bottom:8px' }, `노드 ${scanned.nodes} · 토픽 ${scanned.topics}  —  `,
        el('span', { style: 'color:var(--red)' }, counts.ERROR + ' ERROR'), ' · ',
        el('span', { style: 'color:var(--yellow)' }, counts.WARN + ' WARN'), ' · ',
        el('span', { style: 'color:var(--dim)' }, counts.INFO + ' INFO')));
      if (!issues.length) { wrap.append(el('p', { style: 'color:var(--green)' }, '✓ 문제 없음 — 그래프가 건강합니다')); return; }
      const tbl = el('table', { class: 'tbl' });
      issues.forEach((iss) => { const row = el('tr', { style: 'cursor:pointer' }, el('td', { style: 'color:' + clr[iss.sev] + ';white-space:nowrap' }, mark[iss.sev] + ' ' + SEV[iss.sev]), el('td', { style: 'color:var(--cyan)' }, iss.target), el('td', {}, iss.msg));
        row.onclick = () => { const it = byName(iss.target); if (it) { closeModal(); onPick(it); } }; tbl.append(row); });
      wrap.append(tbl); };
    draw(); const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
  },
  async baseline() {
    const wrap = el('div', {}); openModal('📌 Baseline / 회귀', wrap, () => {});
    const clr = ['var(--red)', 'var(--yellow)', 'var(--dim)'], mark = ['●', '▲', 'ℹ'], SV = ['ERROR', 'WARN', 'INFO'];
    let base = null;
    const save = async () => { await post('/api/baseline', { profile: { ...snapProfile(items), at: Date.now() } }); base = (await api('/api/baseline')).baseline; draw(); toast('기준선 저장됨', 'ok'); };
    const draw = () => { wrap.innerHTML = '';
      const bar = el('div', { class: 'actbtns', style: 'margin-bottom:8px' }, el('button', { class: 'act', onclick: save }, base ? '기준선 재저장(현재)' : '현재를 기준선으로 저장'));
      wrap.append(bar);
      if (!base) { wrap.append(el('p', { style: 'color:var(--yellow)' }, '저장된 기준선이 없습니다. 정상 상태에서 위 버튼으로 기준선을 저장하세요.')); return; }
      const when = base.at ? new Date(base.at).toLocaleString() : '';
      wrap.append(el('div', { class: 'hint', style: 'margin-bottom:6px' }, `기준선: 노드 ${(base.nodes || []).length} · 토픽 ${Object.keys(base.topics || {}).length}${when ? ' · ' + when : ''}`));
      const rows = diffBaseline(base, items);
      if (!rows.length) { wrap.append(el('p', { style: 'color:var(--green)' }, '✓ 기준선과 동일 — 회귀 없음')); return; }
      const tbl = el('table', { class: 'tbl' });
      rows.forEach((r) => { const tr = el('tr', { style: 'cursor:pointer' }, el('td', { style: 'color:' + clr[r.sev] + ';white-space:nowrap' }, mark[r.sev] + ' ' + SV[r.sev]), el('td', { style: 'color:var(--cyan)' }, r.target), el('td', {}, r.msg)); tr.onclick = () => { const it = byName(r.target); if (it) { closeModal(); onPick(it); } }; tbl.append(tr); });
      wrap.append(tbl); };
    base = (await api('/api/baseline')).baseline; draw();
    const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
  },
  cloud(it) {
    // 🧊 3D 씬 — RViz 식 Displays 패널: 여러 토픽(클라우드/마커)을 동시에 씬에 올리고 체크박스로 표시/숨김,
    //   TF·그리드·축·LOD 내장 디스플레이, 거리 LOD 렌더, FPS·점수·벽시계/시뮬시각 표시.
    const cloudTopics = () => items.filter((i) => (i.ty || '').includes('PointCloud2')).map((i) => i.name);
    const markerTopics = () => items.filter((i) => /visualization_msgs\/(msg\/)?Marker(Array)?/.test(i.ty || '')).map((i) => i.name);
    const GEOMRE = /LaserScan|nav_msgs\/(msg\/)?Path|Odometry|PoseArray|PoseStamped|PointStamped|OccupancyGrid|VehicleOdometry/;
    const geomTopics = () => items.filter((i) => GEOMRE.test(i.ty || '')).map((i) => [i.name, i.ty || '']);
    const imgTopics = () => items.filter((i) => /CompressedImage|sensor_msgs\/(msg\/)?Image/.test(i.ty || '')).map((i) => i.name);
    const camInfoTopics = () => items.filter((i) => /CameraInfo/.test(i.ty || '')).map((i) => i.name);
    const imTopics = () => items.filter((i) => /InteractiveMarkerUpdate/.test(i.ty || '')).map((i) => i.name.replace(/\/update$/, ''));
    const camImgEl = new Image(); let camImgES = null, camInfES = null, camObj = null;
    const subCamImg = (t) => { if (camImgES) { camImgES.close(); camImgES = null; } if (!t) { scene.clearCamera(); return; } camImgES = openStream('/imgstream?topic=' + encodeURIComponent(t), (d) => { if (!d) return; camImgEl.onload = () => { if (camObj) scene.setCamImage(camImgEl, camObj, camObj.frame_id); }; camImgEl.src = 'data:image/jpeg;base64,' + d; }); };
    const subCamInf = (t) => { if (camInfES) { camInfES.close(); camInfES = null; } if (!t) return; camInfES = openStream('/caminfostream?topic=' + encodeURIComponent(t), (d) => { try { camObj = JSON.parse(d); } catch (_) { /* */ } }); };
    const cv = el('canvas', { width: 900, height: 560, style: 'width:100%;height:560px;background:#0b0e12;border:1px solid var(--line);border-radius:6px;cursor:grab;display:block' });
    const labelDiv = el('div', { style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden' });
    const fpsOv = el('div', { style: 'position:absolute;left:8px;top:8px;font:11px monospace;color:#9aa7b8;background:rgba(13,17,22,.6);padding:2px 7px;border-radius:4px;pointer-events:none' });
    const stage = el('div', { style: 'position:relative;flex:1;min-width:0' }, cv, labelDiv, fpsOv);
    const info = el('div', { class: 'hint', style: 'margin-top:4px' }, '드래그=회전 · 휠=줌 · 우클릭드래그=이동 · 기즈모 드래그=마커 이동/회전');
    const scene = mkScene(cv, labelDiv, info);
    const displays = new Map();   // id → {id,kind,topic,es,on}
    const idOf = (kind, topic) => kind + ':' + topic;
    let cloudMode = 'xyz', colorSel = null, frameIds = [], lastFrameIds = '';   // 클라우드 채널 + TF 프레임 목록(카메라 옵션용)
    const subscribe = (d) => { if (d.kind === 'cloud') { d.es = openStream('/cloudstream?topic=' + encodeURIComponent(d.topic), (data) => { const r = decodeCloud(data); if (!r) return; cloudMode = r.mode; if (colorSel && colorSel.value === 'auto') applyAutoColor(); scene.setCloudById(d.id, r.arr); }); }
      else if (d.kind === 'geom') { d.es = openStream('/geomstream?topic=' + encodeURIComponent(d.topic) + '&type=' + encodeURIComponent(d.ty || ''), (data) => { try { const o = JSON.parse(data); scene.setMarkersById(d.id, o.markers || []); } catch (_) { /* */ } }); }
      else if (d.kind === 'im') { d.es = openStream('/imstream?topic=' + encodeURIComponent(d.topic), (data) => { try { const o = JSON.parse(data); scene.setInteractiveMarkers(o.ims || []); } catch (_) { /* */ } });
        scene.setImHandler((name, pose, event, control) => { if (d.es) d.es.feed({ name, pose, event, control }); }); }   // 기즈모 드래그 → <topic>/feedback 발행
      else { d.es = openStream('/markerstream?topic=' + encodeURIComponent(d.topic), (data) => { try { const o = JSON.parse(data); scene.setMarkersById(d.id, o.markers || (Array.isArray(o) ? o : [o])); } catch (_) { /* */ } }); } };
    const applyAutoColor = () => scene.opts({ colorMode: cloudMode === 'rgb' ? 2 : cloudMode === 'intensity' ? 1 : 0 });
    const unsubscribe = (d) => { if (d.es) { d.es.close(); d.es = null; } if (d.kind === 'cloud') scene.setCloudById(d.id, null); else if (d.kind === 'im') { scene.setInteractiveMarkers([]); scene.setImHandler(null); } else scene.setMarkersById(d.id, []); };
    const addDisplay = (kind, topic, ty) => { const id = idOf(kind, topic); if (displays.has(id)) return; const d = { id, kind, topic, ty, on: true }; displays.set(id, d); subscribe(d); renderList(); };
    const toggle = (d) => { d.on = !d.on; if (d.on) subscribe(d); else unsubscribe(d); renderList(); };
    const removeD = (d) => { unsubscribe(d); scene.removeDisplay(d.kind, d.id); displays.delete(d.id); renderList(); };
    const builtin = { grid: true, axes: true, tf: true, robot: false }; let tfES = null, urdfES = null;
    const subTF = (on) => { if (tfES) { tfES.close(); tfES = null; } scene.setTF([]); if (!on) return; tfES = openStream('/tfstream', (data) => { try { const o = JSON.parse(data); const fr = o.frames || []; scene.setTF(fr); const ids = fr.map((f) => f.id).join(','); if (ids !== lastFrameIds) { lastFrameIds = ids; frameIds = fr.map((f) => f.id); renderCam(); } } catch (_) { /* */ } }); };
    const subRobot = (on) => { if (urdfES) { urdfES.close(); urdfES = null; } scene.setMarkersById('__robot__', []); if (!on) return; urdfES = openStream('/urdfstream', (data) => { try { const o = JSON.parse(data); scene.setMarkersById('__robot__', o.markers || []); } catch (_) { /* */ } }); };
    const listBox = el('div', {});
    const DR = 'display:flex;align-items:center;gap:5px;padding:2px 4px;font-size:11px;cursor:default';
    function renderList() { listBox.innerHTML = '';
      const chk = (label, key, fn) => { const c = el('input', { type: 'checkbox' }); c.checked = builtin[key]; c.onchange = () => { builtin[key] = c.checked; fn(c.checked); }; return el('label', { style: DR }, c, el('span', {}, label)); };
      listBox.append(el('div', { class: 'hint', style: 'margin:4px 0 2px;text-transform:uppercase;letter-spacing:.05em' }, '내장'));
      listBox.append(chk('Grid', 'grid', (v) => scene.opts({ grid: v })), chk('Axes', 'axes', (v) => scene.opts({ axes: v })), chk('TF', 'tf', (v) => subTF(v)), chk('RobotModel (URDF)', 'robot', (v) => subRobot(v)));
      listBox.append(el('div', { class: 'hint', style: 'margin:6px 0 2px;text-transform:uppercase;letter-spacing:.05em' }, '디스플레이'));
      if (!displays.size) listBox.append(el('div', { class: 'hint', style: 'padding:2px 4px' }, '아래에서 토픽 추가'));
      const ICON = { cloud: '🌩 ', marker: '📐 ', geom: '🧭 ', im: '🎯 ' };
      for (const d of displays.values()) { const c = el('input', { type: 'checkbox' }); c.checked = d.on; c.onchange = () => toggle(d);
        const rm = el('span', { style: 'cursor:pointer;color:var(--dim)', title: '제거', onclick: () => removeD(d) }, '✕');
        listBox.append(el('label', { style: DR }, c, el('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: d.topic }, (ICON[d.kind] || '') + d.topic), rm)); }
      const avail = [...cloudTopics().map((t) => ['cloud', t, '']), ...markerTopics().map((t) => ['marker', t, '']), ...geomTopics().map(([t, ty]) => ['geom', t, ty]), ...imTopics().map((t) => ['im', t, ''])].filter(([k, t]) => !displays.has(idOf(k, t)));
      const addSel = el('select', { style: 'width:100%;margin-top:5px;font:11px monospace' }); addSel.append(el('option', { value: '' }, '＋ 토픽 추가…'));
      avail.forEach(([k, t]) => addSel.append(el('option', { value: k + '\0' + t }, (ICON[k] || '') + t)));
      addSel.onchange = () => { if (!addSel.value) return; const [k, t] = addSel.value.split('\0'); const ty = (geomTopics().find(([n]) => n === t) || [])[1] || ''; addDisplay(k, t, ty); };
      listBox.append(addSel); }
    const ptSize = el('input', { type: 'range', min: '1', max: '6', value: '2.4', step: '0.2', style: 'vertical-align:middle' });
    ptSize.oninput = () => scene.setPointSize(+ptSize.value);
    const vbtn = (t, p) => el('button', { class: 'act', style: 'padding:2px 7px', onclick: () => scene.view(p) }, t);
    const topbar = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px' },
      el('span', { style: 'display:inline-flex;gap:3px' }, vbtn('Top', 'top'), vbtn('Front', 'front'), vbtn('Side', 'side'), vbtn('Iso', 'iso')),
      el('label', { style: 'display:inline-flex;align-items:center;gap:4px' }, el('span', { class: 'hint' }, '점크기'), ptSize));
    // ── ⚙ 최적화 옵션(선택 가능) — LOD 모드/거리/목표FPS/최대점수/점모양 ──
    const O = { lodMode: 'adaptive', lodDist: 60, targetFps: 40, maxPoints: 0, round: true, color: 'auto' };
    const optBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
    const olbl = (t, node) => el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, t, node);
    function renderOpt() { optBox.innerHTML = '';
      optBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '⚙ 최적화'));
      const modeSel = el('select', { style: 'width:100%;font:11px monospace' });
      [['off', '끄기 (전량 렌더)'], ['distance', '거리 LOD'], ['adaptive', '적응형 (FPS 유지)']].forEach(([v, l]) => modeSel.append(el('option', { value: v }, l)));
      modeSel.value = O.lodMode; modeSel.onchange = () => { O.lodMode = modeSel.value; scene.opts({ lodMode: O.lodMode }); renderOpt(); };
      optBox.append(olbl('LOD 모드', modeSel));
      // 색상 모드 — 자동(채널 감지)/높이/Intensity/RGB/단색.
      colorSel = el('select', { style: 'width:100%;font:11px monospace' });
      [['auto', '자동 (채널 감지)'], ['0', '높이 (z)'], ['1', 'Intensity'], ['2', 'RGB'], ['3', '단색']].forEach(([v, l]) => colorSel.append(el('option', { value: v }, l)));
      colorSel.value = O.color; colorSel.onchange = () => { O.color = colorSel.value; if (O.color === 'auto') applyAutoColor(); else scene.opts({ colorMode: +O.color }); };
      optBox.append(olbl('색상', colorSel));
      if (O.lodMode !== 'off') { const d = el('input', { type: 'range', min: '5', max: '120', step: '1', value: String(Math.round(O.lodDist)), style: 'width:100%' });
        if (O.lodMode === 'adaptive') d.disabled = true;
        d.oninput = () => { O.lodDist = +d.value; scene.opts({ lodDist: O.lodDist }); }; optBox.append(olbl(O.lodMode === 'adaptive' ? '거리 임계 (자동)' : '거리 임계 (m)', d)); }
      if (O.lodMode === 'adaptive') { const f = el('input', { type: 'range', min: '20', max: '60', step: '5', value: String(O.targetFps), style: 'width:100%' }); const fl = el('span', {}, ' ' + O.targetFps + ' fps');
        f.oninput = () => { O.targetFps = +f.value; scene.opts({ targetFps: O.targetFps }); fl.textContent = ' ' + O.targetFps + ' fps'; }; optBox.append(olbl(el('span', {}, '목표 FPS', fl), f)); }
      const capSel = el('select', { style: 'width:100%;font:11px monospace' });
      [[0, '무제한'], [50000, '5만'], [100000, '10만'], [200000, '20만'], [500000, '50만']].forEach(([v, l]) => capSel.append(el('option', { value: v }, l)));
      capSel.value = String(O.maxPoints); capSel.onchange = () => { O.maxPoints = +capSel.value; scene.opts({ maxPoints: O.maxPoints }); }; optBox.append(olbl('최대 점수 (하드 상한)', capSel));
      const rc = el('input', { type: 'checkbox' }); rc.checked = O.round; rc.onchange = () => { O.round = rc.checked; scene.opts({ round: O.round }); };
      optBox.append(el('label', { style: 'display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11px' }, rc, el('span', {}, '둥근 점 (끄면 사각·더 빠름)'))); }
    renderOpt();
    // ── 🛠 3D 도구 — 그라운드(z=0) 클릭 → Publish Point / Nav Goal / Pose Estimate / 측정 ──
    const toolBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
    const toolTopics = { point: '/clicked_point', goal: '/goal_pose', pose: '/initialpose' };
    const FF = 'map'; let activeTool = null, toolStage = null;
    const sph = (id, p, c) => ({ ns: 'tool', id, type: 2, action: 0, frame_id: FF, pose: { p, q: [0, 0, 0, 1] }, scale: [0.2, 0.2, 0.2], color: c, points: [], colors: [], text: '' });
    const arw = (id, p, yaw, c) => ({ ns: 'tool', id, type: 0, action: 0, frame_id: FF, pose: { p, q: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)] }, scale: [0.7, 0.1, 0.15], color: c, points: [], colors: [], text: '' });
    const showTool = (ms) => scene.setMarkersById('__tool__', ms);
    const clearTool = () => { activeTool = null; toolStage = null; scene.setPickHandler(null); showTool([]); renderTools(); };
    const pub = (topic, yaml) => post('/api/publish', { name: topic, msg: yaml }).then(() => toast('발행 → ' + topic, 'ok')).catch(() => toast('발행 실패', 'err'));
    function onToolPick(w) {
      if (activeTool === 'measure') {
        if (!toolStage) { toolStage = { p1: w }; showTool([sph(1, w, [0.9, 0.8, 0.3, 1])]); }
        else { const p1 = toolStage.p1, d = Math.hypot(w[0] - p1[0], w[1] - p1[1], w[2] - p1[2]);
          showTool([sph(1, p1, [0.9, 0.8, 0.3, 1]), sph(2, w, [0.9, 0.8, 0.3, 1]),
            { ns: 'tool', id: 3, type: 4, action: 0, frame_id: FF, pose: { p: [0, 0, 0], q: [0, 0, 0, 1] }, scale: [0.03, 0, 0], color: [0.9, 0.8, 0.3, 1], points: [p1, w], colors: [], text: '' },
            { ns: 'tool', id: 4, type: 9, action: 0, frame_id: FF, pose: { p: [(p1[0] + w[0]) / 2, (p1[1] + w[1]) / 2, 0.3], q: [0, 0, 0, 1] }, scale: [0, 0, 0.3], color: [1, 1, 1, 1], points: [], colors: [], text: d.toFixed(3) + ' m' }]);
          toast('거리: ' + d.toFixed(3) + ' m', 'info'); toolStage = null; }
        return;
      }
      if (activeTool === 'point') { showTool([sph(1, w, [0.9, 0.42, 0.42, 1])]); pub(toolTopics.point, `{header: {frame_id: "${FF}"}, point: {x: ${w[0].toFixed(3)}, y: ${w[1].toFixed(3)}, z: 0.0}}`); clearTool(); return; }
      if (activeTool === 'goal' || activeTool === 'pose') {
        if (!toolStage) { toolStage = { p1: w }; showTool([sph(1, w, [0.44, 0.6, 0.95, 1])]); return; }
        const p1 = toolStage.p1, yaw = Math.atan2(w[1] - p1[1], w[0] - p1[0]), qz = Math.sin(yaw / 2), qw = Math.cos(yaw / 2);
        showTool([arw(1, p1, yaw, [0.44, 0.6, 0.95, 1])]);
        const posy = `position: {x: ${p1[0].toFixed(3)}, y: ${p1[1].toFixed(3)}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: ${qz.toFixed(4)}, w: ${qw.toFixed(4)}}`;
        pub(activeTool === 'goal' ? toolTopics.goal : toolTopics.pose, activeTool === 'goal'
          ? `{header: {frame_id: "${FF}"}, pose: {${posy}}}`
          : `{header: {frame_id: "${FF}"}, pose: {pose: {${posy}}, covariance: [0.25,0,0,0,0,0, 0,0.25,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0.0685]}}`);
        clearTool();
      }
    }
    function renderTools() { toolBox.innerHTML = '';
      toolBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:3px' }, '🛠 도구'));
      const tb = (label, tool) => el('button', { class: 'act', style: 'padding:2px 6px;margin:2px 3px 2px 0;font-size:11px' + (activeTool === tool ? ';border-color:var(--cyan);color:var(--cyan)' : ''), onclick: () => { if (activeTool === tool) { clearTool(); return; } activeTool = tool; toolStage = null; showTool([]); scene.setPickHandler(onToolPick); renderTools(); } }, label);
      toolBox.append(tb('📍 Point', 'point'), tb('🎯 Nav Goal', 'goal'), tb('📌 Pose', 'pose'), tb('📏 측정', 'measure'));
      toolBox.append(el('div', { class: 'hint', style: 'margin-top:3px' }, activeTool ? (activeTool === 'point' ? '그라운드 클릭 → 발행' : activeTool === 'measure' ? '두 점 클릭 → 거리(반복)' : '클릭=위치, 다시 클릭=방향') : '도구 선택 후 씬 클릭 (z=0 평면)')); }
    renderTools();
    // ── 📷 카메라/프레임 — 고정 프레임(fixed frame) · 추종(follow) · 직교 투영 ──
    const camBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
    const CO = { fixedFrame: '', follow: '', ortho: false, camImg: '', camInf: '', camDist: 2 };
    function frameSelect(cur, first, cb) { const s = el('select', { style: 'width:100%;font:11px monospace' }); s.append(el('option', { value: '' }, first)); frameIds.forEach((f) => s.append(el('option', { value: f }, f))); s.value = cur; s.onchange = () => cb(s.value); return s; }
    function topicPick(list, cur, first, cb) { const s = el('select', { style: 'width:100%;font:11px monospace' }); s.append(el('option', { value: '' }, first)); list.forEach((t) => s.append(el('option', { value: t }, t))); s.value = cur; s.onchange = () => cb(s.value); return s; }
    function renderCam() { camBox.innerHTML = '';
      camBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '📷 카메라 / 프레임'));
      camBox.append(el('label', { class: 'hint', style: 'display:block;margin:4px 0 2px' }, '고정 프레임 (Fixed Frame)'), frameSelect(CO.fixedFrame, '기본 (루트)', (v) => { CO.fixedFrame = v; scene.opts({ fixedFrame: v || null }); }));
      camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, '추종 (Follow)'), frameSelect(CO.follow, '끔', (v) => { CO.follow = v; scene.opts({ follow: v || null }); if (!v) scene.view('iso'); }));
      const oc = el('input', { type: 'checkbox' }); oc.checked = CO.ortho; oc.onchange = () => { CO.ortho = oc.checked; scene.opts({ ortho: oc.checked }); };
      camBox.append(el('label', { style: 'display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11px' }, oc, el('span', {}, '직교 투영 (Orthographic)')));
      // 카메라 이미지 3D 투영
      camBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin:8px 0 2px' }, '🎥 이미지 투영'));
      camBox.append(el('label', { class: 'hint', style: 'display:block;margin:3px 0 2px' }, '이미지'), topicPick(imgTopics(), CO.camImg, '끔', (v) => { CO.camImg = v; subCamImg(v); }));
      camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, 'CameraInfo'), topicPick(camInfoTopics(), CO.camInf, '끔', (v) => { CO.camInf = v; subCamInf(v); }));
      const ds = el('input', { type: 'range', min: '0.3', max: '10', step: '0.1', value: String(CO.camDist), style: 'width:100%' }); ds.oninput = () => { CO.camDist = +ds.value; scene.setCamOpts({ dist: CO.camDist }); };
      camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, '투영 거리 (m)'), ds); }
    renderCam();
    const timeBar = el('div', { class: 'hint', style: 'margin-top:4px' });
    const panel = el('div', { style: 'display:flex;gap:10px' },
      el('div', { style: 'width:210px;flex:none;border-right:1px solid var(--line);padding-right:8px;overflow:auto;max-height:78vh' }, el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '🗂 Displays'), listBox, optBox, toolBox, camBox),
      el('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, topbar, stage, info, timeBar));
    openModal('🧊 3D 씬 (RViz 식)', panel);
    const M = document.querySelector('#modal .m'); if (M) { M.style.width = 'min(1300px,96vw)'; }
    renderList(); subTF(true);
    // 초기 디스플레이: it 지정 시 그 토픽, 아니면 첫 클라우드+첫 마커.
    if (it && markerTopics().includes(it.name)) addDisplay('marker', it.name);
    else if (it && cloudTopics().includes(it.name)) addDisplay('cloud', it.name);
    else { if (cloudTopics()[0]) addDisplay('cloud', cloudTopics()[0]); if (markerTopics()[0]) addDisplay('marker', markerTopics()[0]); }
    const statIv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(statIv); return; }
      const s = scene.getStats(); fpsOv.textContent = `${s.fps} FPS · ${s.drawn.toLocaleString()} / ${s.points.toLocaleString()} pts${s.lodMode !== 'off' ? ` · LOD ${Math.round(s.lodDist)}m` : ''}`;
      const wall = new Date().toLocaleTimeString(); const sim = Clock.sim != null ? Clock.sim.toFixed(2) + 's' : '—';
      timeBar.textContent = `🕒 wall ${wall} · sim ${sim}${Clock.sim == null ? ' (no /clock)' : Clock.stale() ? ' (paused)' : ''}`; }, 500);
    modalSub = { close: () => { clearInterval(statIv); for (const d of displays.values()) if (d.es) d.es.close(); if (tfES) tfES.close(); if (urdfES) urdfES.close(); if (camImgES) camImgES.close(); if (camInfES) camInfES.close(); scene.dispose(); } };
  },
  image(it) {
    // 🖼 카메라 — base64 JPEG SSE + 어노테이션(검출 박스/점/원/텍스트) + 보정(CameraInfo 주점·레티클) 오버레이.
    //   Foxglove 이미지 패널 대응: 원본 이미지 픽셀 좌표계로 온 주석을 표시 크기에 맞춰 스케일 렌더.
    const topic = it ? it.name : (items.find((i) => /CompressedImage|sensor_msgs\/msg\/Image/.test(i.ty || '')) || {}).name;
    if (!topic) { openModal('🖼 카메라', el('p', { class: 'hint' }, '이미지 토픽이 없습니다.')); return; }
    const annTopics = items.filter((i) => /Detection2D(Array)?|ImageAnnotations/.test(i.ty || '')).map((i) => i.name);
    const infoTopics = items.filter((i) => /CameraInfo/.test(i.ty || '')).map((i) => i.name);
    const img = el('img', { style: 'display:block;max-width:100%;background:#0d1116;image-rendering:auto' });
    const ov = el('canvas', { style: 'position:absolute;left:0;top:0;pointer-events:none' });
    const zoomWrap = el('div', { style: 'position:relative;transform-origin:0 0' }, img, ov);
    const stage = el('div', { style: 'position:relative;display:inline-block;max-width:100%;overflow:hidden;border:1px solid var(--line);border-radius:6px;cursor:grab' }, zoomWrap);
    const off = document.createElement('canvas'); const zoom = { s: 1, ox: 0, oy: 0 }; let panning = null;
    const applyZoom = () => { zoomWrap.style.transform = `translate(${zoom.ox}px,${zoom.oy}px) scale(${zoom.s})`; };
    const info = el('div', { class: 'hint', style: 'margin-top:6px' }, '연결 중…'); let n = 0, t0 = Date.now();
    let ann = { boxes: [], points: [], circles: [], texts: [] }, cam = null;
    let annES = null, camES = null;
    // ── 오버레이 렌더: 이미지 원본 픽셀(iw×ih) → 표시 크기(cw×ch) 스케일 ──
    function drawOverlay() {
      const cw = img.clientWidth, ch = img.clientHeight; if (!cw || !ch) return;
      if (ov.width !== cw) ov.width = cw; if (ov.height !== ch) ov.height = ch;
      const iw = (cam && cam.width) || img.naturalWidth || cw, ih = (cam && cam.height) || img.naturalHeight || ch;
      const kx = cw / iw, ky = ch / ih; const ctx = ov.getContext('2d'); ctx.clearRect(0, 0, cw, ch);
      ctx.lineWidth = 2; ctx.font = '12px monospace'; ctx.textBaseline = 'bottom';
      for (const b of ann.boxes) { const x = (b.cx - b.w / 2) * kx, y = (b.cy - b.h / 2) * ky, w = b.w * kx, h = b.h * ky;
        ctx.strokeStyle = '#6fd08c'; ctx.strokeRect(x, y, w, h);
        const tag = (b.label || 'obj') + (b.score ? ' ' + (b.score * 100 | 0) + '%' : '');
        ctx.fillStyle = '#6fd08c'; const tw = ctx.measureText(tag).width + 6; ctx.fillRect(x, y - 15, tw, 15);
        ctx.fillStyle = '#0d1116'; ctx.fillText(tag, x + 3, y - 2); }
      for (const p of ann.points) { ctx.fillStyle = `rgb(${p[2]},${p[3]},${p[4]})`; ctx.beginPath(); ctx.arc(p[0] * kx, p[1] * ky, 3, 0, 7); ctx.fill(); }
      for (const c of ann.circles) { ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`; ctx.beginPath(); ctx.arc(c.x * kx, c.y * ky, c.d / 2 * kx, 0, 7); ctx.stroke(); }
      ctx.fillStyle = '#e2c85a'; for (const t of ann.texts) ctx.fillText(t.t, t.x * kx, t.y * ky);
      if (cam && cam.K && cam.K.length === 9) { // 보정: 주점(cx,cy) 십자 + 이미지 중심 대비
        const px = cam.K[2] * kx, py = cam.K[5] * ky; ctx.strokeStyle = '#c78ad2'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
        ctx.fillStyle = '#c78ad2'; ctx.textBaseline = 'top'; ctx.fillText('principal', px + 6, py + 4); ctx.textBaseline = 'bottom'; }
    }
    const subAnn = (t) => { if (annES) { annES.close(); annES = null; } ann = { boxes: [], points: [], circles: [], texts: [] }; drawOverlay(); if (!t) return;
      annES = openStream('/annstream?topic=' + encodeURIComponent(t), (data) => { try { const o = JSON.parse(data); ann = { boxes: o.boxes || [], points: o.points || [], circles: o.circles || [], texts: o.texts || [] }; drawOverlay(); } catch (_) { /* */ } }); };
    const subCam = (t) => { if (camES) { camES.close(); camES = null; } cam = null; drawOverlay(); if (!t) return;
      camES = openStream('/caminfostream?topic=' + encodeURIComponent(t), (data) => { try { cam = JSON.parse(data); drawOverlay(); camInfoLbl.textContent = cam.K ? `K: fx=${cam.K[0].toFixed(0)} fy=${cam.K[4].toFixed(0)} cx=${cam.K[2].toFixed(0)} cy=${cam.K[5].toFixed(0)} · ${cam.model || ''} D=[${(cam.D || []).map((d) => d.toFixed(3)).join(', ')}]` : ''; } catch (_) { /* */ } }); };
    // ── 소스 선택 컨트롤 ──
    const annSel = el('select', { style: 'font:11px monospace' }); annSel.append(el('option', { value: '' }, '(없음)')); annTopics.forEach((t) => annSel.append(el('option', { value: t }, t))); annSel.onchange = () => subAnn(annSel.value);
    const camSel = el('select', { style: 'font:11px monospace' }); camSel.append(el('option', { value: '' }, '(없음)')); infoTopics.forEach((t) => camSel.append(el('option', { value: t }, t))); camSel.onchange = () => subCam(camSel.value);
    const lbl = (t, node) => el('label', { style: 'display:inline-flex;align-items:center;gap:3px;margin-right:12px' }, el('span', { class: 'hint' }, t), node);
    const camInfoLbl = el('div', { class: 'hint', style: 'margin-top:4px;color:var(--purple,#c78ad2)' });
    const pixLbl = el('span', { class: 'hint', style: 'margin-left:12px;color:var(--cyan)' });
    const zreset = el('button', { class: 'act', style: 'padding:2px 7px', onclick: () => { zoom.s = 1; zoom.ox = 0; zoom.oy = 0; applyZoom(); } }, '1:1');
    const ctrl = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;margin-bottom:6px' }, lbl('어노테이션', annSel), lbl('CameraInfo', camSel), zreset, el('span', { class: 'hint', style: 'margin-left:8px' }, '휠=줌 · 드래그=이동'), pixLbl);
    openModal('🖼 카메라 — ' + topic, el('div', {}, ctrl, stage, info, camInfoLbl));
    // 줌/팬 + 픽셀값 — Foxglove 이미지 패널 대응(휠=커서 기준 줌, 드래그=이동, 이동 시 (x,y) rgb 표시).
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const ns = Math.max(1, Math.min(16, zoom.s * f)); const k = ns / zoom.s; zoom.ox = mx - (mx - zoom.ox) * k; zoom.oy = my - (my - zoom.oy) * k; zoom.s = ns; if (zoom.s <= 1.001) { zoom.s = 1; zoom.ox = 0; zoom.oy = 0; } applyZoom(); }, { passive: false });
    stage.addEventListener('mousedown', (e) => { panning = { x: e.clientX, y: e.clientY }; stage.style.cursor = 'grabbing'; e.preventDefault(); });
    window.addEventListener('mouseup', () => { if (panning) { panning = null; stage.style.cursor = 'grab'; } });
    stage.addEventListener('mousemove', (e) => { if (panning) { zoom.ox += e.clientX - panning.x; zoom.oy += e.clientY - panning.y; panning = { x: e.clientX, y: e.clientY }; applyZoom(); return; }
      const r = img.getBoundingClientRect(); if (!r.width || !off.width) { pixLbl.textContent = ''; return; } const px = Math.floor((e.clientX - r.left) / r.width * off.width), py = Math.floor((e.clientY - r.top) / r.height * off.height);
      if (px < 0 || py < 0 || px >= off.width || py >= off.height) { pixLbl.textContent = ''; return; } let rgb = ''; try { const d = off.getContext('2d').getImageData(px, py, 1, 1).data; rgb = ` · rgb(${d[0]},${d[1]},${d[2]})`; } catch (_) { /* */ } pixLbl.textContent = `(${px}, ${py})${rgb}`; });
    const es = openStream('/imgstream?topic=' + encodeURIComponent(topic), (d) => { if (!d) return; img.src = 'data:image/jpeg;base64,' + d; n++; const fps = n / ((Date.now() - t0) / 1000); info.textContent = `${n} 프레임 · ${fps.toFixed(1)} fps`; drawOverlay(); });
    img.onload = () => { off.width = img.naturalWidth; off.height = img.naturalHeight; try { off.getContext('2d').drawImage(img, 0, 0); } catch (_) { /* */ } drawOverlay(); };
    if (annTopics[0]) { annSel.value = annTopics[0]; subAnn(annTopics[0]); }
    if (infoTopics[0]) { camSel.value = infoTopics[0]; subCam(infoTopics[0]); }
    modalSub = { close: () => { es.close(); if (annES) annES.close(); if (camES) camES.close(); } };
  },
  map(it) {
    // 🗺 GPS 지도 — NavSatFix lat/lon 궤적을 캔버스에 플롯(외부 타일 없이, 오프라인/CSP 안전).
    const topic = it ? it.name : (items.find((i) => (i.ty || '').includes('NavSatFix')) || {}).name;
    if (!topic) { openModal('🗺 GPS 지도', el('p', { class: 'hint' }, 'NavSatFix 토픽이 없습니다.')); return; }
    const cv = el('canvas', { width: 900, height: 460, style: 'width:100%;height:460px;background:#0d1116;border:1px solid var(--line);border-radius:6px' });
    const info = el('div', { class: 'hint', style: 'margin-top:6px' });
    openModal('🗺 GPS 지도 — ' + topic, el('div', {}, el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'NavSatFix 위경도 궤적 (외부 타일 없이 로컬 렌더)'), cv, info));
    const track = []; let cur = null;
    modalSub = openStream('/echo?topic=' + encodeURIComponent(topic), (d) => { const text = JSON.parse(d); const g = {};
      for (const m of text.matchAll(/^(latitude|longitude|altitude):\s*(-?\d+\.?\d*)/gm)) g[m[1]] = parseFloat(m[2]);
      if (g.latitude == null || g.longitude == null) return;
      cur = g; track.push([g.longitude, g.latitude]); if (track.length > 2000) track.shift();
      info.textContent = `lat ${g.latitude.toFixed(6)} · lon ${g.longitude.toFixed(6)} · alt ${(g.altitude ?? 0).toFixed(1)} m · ${track.length} pts`;
      draw(); });
    function draw() {
      const ctx = cv.getContext('2d'); const W = cv.width = cv.clientWidth, H = cv.height; ctx.clearRect(0, 0, W, H);
      if (track.length < 2) return;
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
      for (const [x, y] of track) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
      const pad = 40, latMid = (mny + mxy) / 2; const sx = (mxx - mnx) || 1e-6, sy = (mxy - mny) || 1e-6;
      // 위도 보정(경도 축소) — 간이 등거리. 종횡비 유지.
      const scale = Math.min((W - 2 * pad) / (sx * Math.cos(latMid * Math.PI / 180)), (H - 2 * pad) / sy);
      const px = (x) => pad + (x - mnx) * Math.cos(latMid * Math.PI / 180) * scale;
      const py = (y) => H - pad - (y - mny) * scale;
      ctx.strokeStyle = '#232b36'; ctx.lineWidth = 1; for (let i = 0; i <= 4; i++) { const gy = pad + (H - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke(); const gx = pad + (W - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - pad); ctx.stroke(); }
      ctx.strokeStyle = '#57c7d4'; ctx.lineWidth = 2; ctx.beginPath(); track.forEach(([x, y], i) => { const X = px(x), Y = py(y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      if (cur) { ctx.fillStyle = '#e2c85a'; ctx.beginPath(); ctx.arc(px(cur.longitude), py(cur.latitude), 5, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#8b97a7'; ctx.font = '10px monospace'; ctx.fillText(`${mny.toFixed(5)}..${mxy.toFixed(5)}°N`, pad, 14); ctx.fillText(`${mnx.toFixed(5)}..${mxx.toFixed(5)}°E`, pad, H - 8);
    }
  },
  plotlab() {
    // 📈 PlotJuggler 스타일 — 다중 동기 플롯 · 여러 토픽 커브 · 공유 시간축/커서 · 줌/팬 · 변환 · 통계.
    const PAL = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2', '#e06a6a', '#6f9be0', '#d98a4b', '#7ad2b8'];
    const S = { es: {}, series: {}, fields: {}, bag: new Set(), t0: Date.now() };
    const sub = (topic) => { if (S.es[topic] || S.bag.has(topic)) return;
      S.es[topic] = openStream('/echo?topic=' + encodeURIComponent(topic), (d) => { let text; try { text = JSON.parse(d); } catch (_) { return; } const nums = numeric(text); const t = (Date.now() - S.t0) / 1000; S.fields[topic] = Object.keys(nums);
        for (const [k, v] of Object.entries(nums)) { const key = topic + ' ' + k; (S.series[key] || (S.series[key] = [])).push([t, v]); if (S.series[key].length > 4000) S.series[key].shift(); } }); };
    const view = { W: 10, follow: true, tEnd: 0 }; const plots = []; let colorI = 0, cursorT = null;
    const TF = { raw: '원값', d1: 'd/dt', d2: 'd²/dt²', d3: 'd³/dt³', i1: '∫dt', i2: '∫∫dt', abs: '|x|', movavg: '이동평균' };
    const derivOnce = (d) => { const o = []; for (let i = 1; i < d.length; i++) { const dt = d[i][0] - d[i - 1][0] || 1e-6; o.push([d[i][0], (d[i][1] - d[i - 1][1]) / dt]); } return o; };
    const integOnce = (d) => { const o = []; let a = 0; for (let i = 1; i < d.length; i++) { a += (d[i][1] + d[i - 1][1]) / 2 * (d[i][0] - d[i - 1][0]); o.push([d[i][0], a]); } return o; };
    const applyT = (data, tf) => { if (!data || data.length < 2 || tf === 'raw') return data || [];
      if (tf[0] === 'd') { let r = data; const n = +tf[1] || 1; for (let k = 0; k < n && r.length > 1; k++) r = derivOnce(r); return r; }   // n차 미분
      if (tf[0] === 'i') { let r = data; const n = +tf[1] || 1; for (let k = 0; k < n && r.length > 1; k++) r = integOnce(r); return r; }   // n차 적분
      if (tf === 'abs') return data.map(([t, v]) => [t, Math.abs(v)]);
      if (tf === 'movavg') { const n = 12, q = []; let s = 0; const o = []; for (const [t, v] of data) { q.push(v); s += v; if (q.length > n) s -= q.shift(); o.push([t, s / q.length]); } return o; }
      return data; };
    // FFT — 창 데이터를 N(2^k) 균일 샘플로 리샘플 후 radix-2 FFT → [주파수Hz, 크기] 배열(양의 주파수).
    const fft = (re, im, N) => { for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
      for (let len = 2; len <= N; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = i + k + len / 2; const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } } };
    const fftMag = (data, N = 256) => { if (!data || data.length < 8) return null; const t0 = data[0][0], t1 = data[data.length - 1][0], span = t1 - t0 || 1;
      const re = new Float64Array(N), im = new Float64Array(N); let j = 0;
      for (let k = 0; k < N; k++) { const t = t0 + span * k / (N - 1); while (j < data.length - 2 && data[j + 1][0] < t) j++; const a = data[j], b = data[Math.min(j + 1, data.length - 1)]; const f = (t - a[0]) / ((b[0] - a[0]) || 1); re[k] = a[1] + (b[1] - a[1]) * f; }
      let m = 0; for (let k = 0; k < N; k++) m += re[k]; m /= N; for (let k = 0; k < N; k++) re[k] -= m;   // DC 제거
      fft(re, im, N); const fs = (N - 1) / span, half = N / 2, out = []; for (let k = 1; k < half; k++) out.push([k * fs / N, Math.hypot(re[k], im[k]) * 2 / N]); return out; };
    const latestT = () => { let m = 0; for (const k in S.series) { const a = S.series[k]; if (a.length) m = Math.max(m, a[a.length - 1][0]); } return m; };

    const list = el('div', { class: 'pl-list' }), grid = el('div', { class: 'pl-grid' }), win = el('span', { class: 'hint' });
    const foll = el('button', { class: 'act', onclick: () => { view.follow = !view.follow; foll.textContent = view.follow ? '▶ follow' : '⏸ frozen'; } }, '▶ follow');
    let layoutW = '100%';
    const setLayout = (w) => { layoutW = w; plots.forEach((p) => { p.cell.style.width = w; p.cell.style.height = '230px'; }); };
    const dl = (name, u) => { const a = el('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); };
    const exportCSV = () => { const rows = ['plot,curve,transform,t,value']; plots.forEach((p, pi) => p.curves.forEach((c) => { if (c.custom) return; const data = applyT(S.series[c.key], c.tf); if (!data) return; for (const [t, v] of data) rows.push(`${pi},${c.topic}/${c.field},${c.tf},${(+t).toFixed(4)},${v}`); }));
      if (rows.length <= 1) { toast('내보낼 데이터가 없습니다', 'warn'); return; } dl('rdash_plots.csv', 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))); toast(`CSV 내보냄 (${rows.length - 1}행)`, 'ok'); };
    const bar = el('div', { class: 'pl-bar' },
      el('button', { class: 'act', onclick: () => addPlot() }, '+ 플롯'),
      el('button', { class: 'act', onclick: () => setLayout('100%') }, '≡ 세로'),
      el('button', { class: 'act', onclick: () => setLayout('calc(50% - 5px)') }, '⊞ 격자'),
      el('button', { class: 'act', onclick: () => setLayout('calc(33.33% - 6px)') }, '⊟ 3열'),
      el('span', { class: 'hint' }, '창'), ...[5, 10, 30].map((w) => el('button', { class: 'act', onclick: () => { view.W = w; } }, w + 's')),
      el('button', { class: 'act', title: '모든 플롯 데이터를 CSV 로', onclick: exportCSV }, '⭳ CSV'),
      foll, win);
    const pb = { playing: false, speed: 1, last: 0 };
    const scrub = el('input', { type: 'range', min: '0', max: '100', value: '0', step: '0.01', class: 'pl-scrub' });
    const playBtn = el('button', { class: 'act', onclick: () => { pb.playing = !pb.playing; pb.last = 0; playBtn.textContent = pb.playing ? '⏸' : '▶'; view.follow = false; foll.textContent = '⏸ frozen'; } }, '▶');
    const spdSel = el('select', {}); [0.25, 0.5, 1, 2, 4].forEach((s) => spdSel.append(el('option', { value: s }, s + '×'))); spdSel.value = '1'; spdSel.onchange = () => { pb.speed = +spdSel.value; };
    const scrubLbl = el('span', { class: 'hint' });
    scrub.oninput = () => { view.follow = false; foll.textContent = '⏸ frozen'; view.tEnd = +scrub.value; };
    const scrubBar = el('div', { class: 'pl-scrubbar' }, playBtn, spdSel, scrub, scrubLbl);
    const bagInp = el('input', { placeholder: 'bag 경로(디렉터리)', style: 'width:140px' });
    const bagBtn = el('button', { class: 'act' }, '🗀 bag');
    bagBtn.onclick = async () => { const pth = bagInp.value.trim(); if (!pth) return; bagBtn.textContent = '로딩…'; let r; try { r = await api('/api/bagdump?path=' + encodeURIComponent(pth) + '&topics='); } catch (_) { r = {}; } bagBtn.textContent = '🗀 bag';
      if (r && r.series && Object.keys(r.series).length) { for (const key in r.series) { S.series[key] = r.series[key]; const sp = key.indexOf(' '); const tp = key.slice(0, sp), fld = key.slice(sp + 1); S.bag.add(tp); if (S.es[tp]) { S.es[tp].close(); delete S.es[tp]; } S.fields[tp] = S.fields[tp] || []; if (!S.fields[tp].includes(fld)) S.fields[tp].push(fld); }
        view.follow = false; foll.textContent = '⏸ frozen'; view.W = Math.max(5, r.t1 || 10); view.tEnd = r.t1 || 0; drawList(); win.textContent = ` 📁 bag: ${Object.keys(r.series).length} 커브 · ${(r.t1 || 0).toFixed(1)}s`; }
      else win.textContent = ' bag 로드 실패(경로/rosbag2 확인)'; };
    bar.append(bagInp, bagBtn);
    openModal('📈 PlotLab — 다중 동기 플롯 (PlotJuggler 스타일)', el('div', { class: 'pl' }, bar, el('div', { class: 'pl-body' }, list, grid), scrubBar));
    const M = document.querySelector('#modal .m'); const savedW = M ? M.style.cssText : ''; if (M) { M.style.width = 'min(1500px,97vw)'; M.style.height = '90vh'; M.style.maxHeight = '90vh'; }

    const search = el('input', { placeholder: '토픽/필드 검색…', style: 'width:100%;margin-bottom:6px' }), listBody = el('div', {});
    list.append(el('div', { class: 'hint', style: 'margin-bottom:4px' }, '커브 (드래그 → 플롯)'), search, listBody);
    const drawList = () => { const f = search.value.toLowerCase(); listBody.innerHTML = '';
      const tset = new Set(items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')).map((i) => i.name)); Object.keys(S.fields).forEach((t) => tset.add(t));
      for (const tp of [...tset].sort()) {
        const flds = S.fields[tp] || []; if (f && !tp.toLowerCase().includes(f) && !flds.some((x) => (tp + ' ' + x).toLowerCase().includes(f))) continue;
        const head = el('div', { class: 'pl-topic' }, (flds.length ? '▾ ' : '▸ ') + tp); head.onclick = () => { sub(tp); setTimeout(drawList, 350); }; listBody.append(head);
        for (const fld of flds) { const key = tp + ' ' + fld; if (f && !key.toLowerCase().includes(f)) continue; const chip = el('div', { class: 'pl-chip', draggable: 'true', title: '드래그 또는 클릭 → 마지막 플롯' }, fld); chip.ondragstart = (e) => e.dataTransfer.setData('text/plain', key); chip.onclick = () => { if (plots.length) addCurve(plots[plots.length - 1], key); }; listBody.append(chip); } } };
    search.oninput = drawList; drawList();
    const listIv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(listIv); return; } drawList(); }, 1500);

    function addCurve(plot, key) { if (!key || plot.curves.some((c) => c.key === key)) return; const sp = key.indexOf(' '); const topic = key.slice(0, sp); sub(topic); plot.curves.push({ key, topic, field: key.slice(sp + 1), color: PAL[colorI++ % PAL.length], tf: 'raw' }); plot.drawLegend(); }
    // 새창(pop-out) — 이 플롯의 커브 설정을 popup.html 에 넘겨 독립 창에서 렌더(같은 SSE 재사용).
    function popOut(plot) {
      const curves = plot.curves.filter((c) => !c.custom).map((c) => ({ topic: c.topic, field: c.field, tf: c.tf, color: c.color }));
      if (!curves.length) { toast('커브를 먼저 추가하세요', 'warn'); return; }
      const cfg = encodeURIComponent(JSON.stringify({ curves, xy: !!plot.xy, fft: !!plot.fft, W: view.W }));
      window.open('/popup.html#' + cfg, '_blank', 'width=780,height=470');
    }
    function addPlot() {
      const canvas = el('canvas', { class: 'pl-canvas' }), legend = el('div', { class: 'pl-legend' }), cell = el('div', { class: 'pl-cell' });
      const plot = { curves: [], canvas, legend, cell };
      const drawLegend = () => { legend.innerHTML = '';
        const xyBtn = el('span', { class: 'pl-btn2' + (plot.xy ? ' on' : ''), title: 'XY 플롯(c0=X)', onclick: () => { plot.xy = !plot.xy; if (plot.xy) plot.fft = false; drawLegend(); } }, 'XY');
        const fftBtn = el('span', { class: 'pl-btn2' + (plot.fft ? ' on' : ''), title: 'FFT 스펙트럼(주파수축)', onclick: () => { plot.fft = !plot.fft; if (plot.fft) plot.xy = false; drawLegend(); } }, 'FFT');
        const fxBtn = el('span', { class: 'pl-btn2', title: '커스텀 수식 커브', onclick: () => { plot._fx = !plot._fx; drawLegend(); } }, 'ƒ');
        legend.append(el('span', { class: 'pl-cv' }, xyBtn, fftBtn, fxBtn));
        if (plot._fx) { const inp = el('input', { placeholder: '수식(c0,c1…): c0-c1, Math.hypot(c0,c1)' }); const add = el('button', { class: 'pl-btn2', onclick: () => { const ex = inp.value.trim(); if (!ex) return; let fn; try { fn = new Function('c', 'Math', 't', 'return (' + ex + ')'); } catch (_) { return; } plot.curves.push({ custom: true, expr: ex, fn, field: 'ƒ ' + ex, topic: '', color: PAL[colorI++ % PAL.length], tf: 'raw' }); plot._fx = false; drawLegend(); } }, '추가'); legend.append(el('span', { class: 'pl-fx' }, inp, add)); }
        let si = 0; plot.curves.forEach((c) => {
          const idx = c.custom ? null : 'c' + (si++);
          const name = c.custom ? c.field : (idx + ': ' + c.topic.replace(/^\//, '') + '/' + c.field);
          const kids = [el('span', { class: 'pl-dot', style: 'background:' + c.color }), name];
          if (!c.custom) { const selT = el('select', {}); for (const t in TF) selT.append(el('option', { value: t }, TF[t])); selT.value = c.tf; selT.onchange = () => { c.tf = selT.value; }; kids.push(selT); }
          c._st = el('span', { class: 'pl-stat' }); kids.push(c._st, el('span', { class: 'pl-rm', onclick: () => { plot.curves = plot.curves.filter((z) => z !== c); drawLegend(); } }, '×'));
          legend.append(el('span', { class: 'pl-cv' }, ...kids)); }); };
      plot.drawLegend = drawLegend;
      cell.ondragover = (e) => { e.preventDefault(); cell.classList.add('drop'); };
      cell.ondragleave = () => cell.classList.remove('drop');
      cell.ondrop = (e) => { e.preventDefault(); cell.classList.remove('drop'); addCurve(plot, e.dataTransfer.getData('text/plain')); };
      cell.style.width = layoutW;
      cell.append(canvas, legend,
        el('button', { class: 'pl-x', style: 'right:46px', title: 'PNG 이미지 저장', onclick: () => { const c = el('canvas', { width: canvas.width, height: canvas.height }); const cx = c.getContext('2d'); cx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg2') || '#0d1116'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(canvas, 0, 0); dl('rdash_plot.png', c.toDataURL('image/png')); toast('PNG 저장됨', 'ok'); } }, '⭳'),
        el('button', { class: 'pl-x', style: 'right:26px', title: '새창에서 보기', onclick: () => popOut(plot) }, '⧉'),
        el('button', { class: 'pl-x', onclick: () => { const i = plots.indexOf(plot); if (i >= 0) plots.splice(i, 1); cell.remove(); } }, '✕'));
      plots.push(plot); grid.append(cell);
    }
    addPlot();

    // 소스 데이터에서 시각 t 에서의 최근값(≤t) — 커스텀 수식 리샘플링용.
    const sampleAt = (data, t) => { if (!data || !data.length) return 0; let lo = 0, hi = data.length - 1, r = data[0][1]; while (lo <= hi) { const m = (lo + hi) >> 1; if (data[m][0] <= t) { r = data[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
    const evalCustom = (c, srcs, t0, t1) => { if (!srcs.length || !c.fn) return []; const base = applyT(S.series[srcs[0].key], srcs[0].tf).filter(([t]) => t >= t0 && t <= t1); const others = srcs.map((s) => applyT(S.series[s.key], s.tf)); const o = [];
      for (const [t] of base) { let v; try { v = c.fn(others.map((d) => sampleAt(d, t)), Math, t); } catch (_) { v = NaN; } if (isFinite(v)) o.push([t, v]); } return o; };
    let raf = 0, alive = true;
    function frame() { if (!alive) return;
      const lt = latestT(); let minT = Infinity, maxT = 0; for (const k in S.series) { const a = S.series[k]; if (a.length) { if (a[0][0] < minT) minT = a[0][0]; if (a[a.length - 1][0] > maxT) maxT = a[a.length - 1][0]; } } if (!isFinite(minT)) minT = 0;
      const now = Date.now(); if (pb.playing) { const dt = (now - (pb.last || now)) / 1000 * pb.speed; view.tEnd = Math.min(maxT, view.tEnd + dt); if (view.tEnd >= maxT - 1e-3) { pb.playing = false; playBtn.textContent = '▶'; } } pb.last = now;
      if (view.follow) view.tEnd = lt;
      if (document.activeElement !== scrub) { scrub.min = minT; scrub.max = maxT || 1; scrub.value = view.tEnd; }
      const t1 = view.tEnd, t0 = t1 - view.W; win.textContent = ` t=${t1.toFixed(1)}s · 창 ${view.W.toFixed(0)}s`; scrubLbl.textContent = ` ${(t1 - minT).toFixed(1)}/${(maxT - minT).toFixed(1)}s`;
      for (const pl of plots) { const cv = pl.canvas, W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight || 150, ctx = cv.getContext('2d'); ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = '#1b222c'; ctx.lineWidth = 1; for (let i = 0; i <= 4; i++) { const y = H * i / 4; ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W, y); ctx.stroke(); }
        const srcs = pl.curves.filter((c) => !c.custom);
        const cd = pl.curves.map((c) => ({ c, d: c.custom ? evalCustom(c, srcs, t0, t1) : applyT(S.series[c.key], c.tf).filter(([t]) => t >= t0 && t <= t1) }));
        if (pl.fft) {   // ── FFT 스펙트럼: X=주파수(Hz), Y=크기 ──
          const spectra = cd.map((z) => ({ c: z.c, m: fftMag(z.d) })).filter((z) => z.m);
          let fmax = 1, amax = 1e-9; for (const { m } of spectra) for (const [f, a] of m) { if (f > fmax) fmax = f; if (a > amax) amax = a; }
          const PX = (f) => 32 + f / fmax * (W - 40), PY = (a) => H - 12 - a / amax * (H - 20);
          ctx.strokeStyle = '#1b222c'; for (let i = 0; i <= 4; i++) { const x = 32 + (W - 40) * i / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 12); ctx.stroke(); }
          ctx.fillStyle = '#5c6672'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.fillText('0Hz', 32, H - 2); ctx.textAlign = 'right'; ctx.fillText(fmax.toFixed(0) + 'Hz', W - 4, H - 2); ctx.textAlign = 'left'; ctx.fillText('|X|', 2, 9);
          for (const { c, m } of spectra) { ctx.strokeStyle = c.color; ctx.lineWidth = 1.3; ctx.beginPath(); m.forEach(([f, a], i) => { const x = PX(f), y = PY(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
            if (c._st) { let pk = 0, pf = 0; for (const [f, a] of m) if (a > pk) { pk = a; pf = f; } c._st.textContent = ` peak ${pf.toFixed(1)}Hz`; } }
          continue;
        }
        if (pl.xy && srcs.length >= 2) {   // ── XY 플롯: c0=X, 나머지=Y ──
          const xd = cd.find((z) => z.c === srcs[0]).d; let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
          for (const [, v] of xd) { if (v < xmn) xmn = v; if (v > xmx) xmx = v; }
          const yset = cd.filter((z) => z.c !== srcs[0]); for (const { d } of yset) for (const [, v] of d) { if (v < ymn) ymn = v; if (v > ymx) ymx = v; }
          if (!isFinite(xmn)) { xmn = 0; xmx = 1; } if (xmx - xmn < 1e-9) { xmx += 1; xmn -= 1; } if (!isFinite(ymn)) { ymn = 0; ymx = 1; } if (ymx - ymn < 1e-9) { ymx += 1; ymn -= 1; }
          const PX = (v) => 32 + (v - xmn) / (xmx - xmn) * (W - 40), PY = (v) => H - 6 - (v - ymn) / (ymx - ymn) * (H - 20);
          ctx.fillStyle = '#5c6672'; ctx.font = '9px monospace'; ctx.fillText('X:' + srcs[0].field, 34, H - 3); ctx.fillText(ymx.toPrecision(3), 2, 9);
          for (const { c, d } of yset) { ctx.strokeStyle = c.color; ctx.lineWidth = 1.2; ctx.beginPath(); d.forEach(([t, vy], i) => { const vx = sampleAt(applyT(S.series[srcs[0].key], srcs[0].tf), t); const x = PX(vx), y = PY(vy); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
          continue;
        }
        let mn = Infinity, mx = -Infinity; for (const { d } of cd) for (const [, v] of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
        if (!isFinite(mn)) { mn = 0; mx = 1; } if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
        const X = (t) => 32 + (t - t0) / (view.W || 1) * (W - 36), Y = (v) => H - 4 - (v - mn) / (mx - mn) * (H - 18);
        ctx.fillStyle = '#5c6672'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.fillText(mx.toPrecision(3), 2, 9); ctx.fillText(mn.toPrecision(3), 2, H - 4);
        for (const { c, d } of cd) { ctx.strokeStyle = c.color; ctx.lineWidth = 1.3; ctx.beginPath(); d.forEach(([t, v], i) => { const x = X(t), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
          if (c._st && d.length) { let s = 0, lo = Infinity, hi = -Infinity; for (const [, v] of d) { s += v; if (v < lo) lo = v; if (v > hi) hi = v; } c._st.textContent = ` [${d[d.length - 1][1].toPrecision(3)}] μ${(s / d.length).toPrecision(3)} ↕${lo.toPrecision(2)}~${hi.toPrecision(2)}`; } }
        if (cursorT != null && cursorT >= t0 && cursorT <= t1) { const cx = X(cursorT); ctx.strokeStyle = '#8b97a7'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke(); ctx.setLineDash([]); } }
      raf = requestAnimationFrame(frame); if (SNAP && ++frame.n > 900) alive = false; }
    frame.n = 0; frame();

    grid.addEventListener('wheel', (e) => { e.preventDefault(); view.W = Math.max(1, Math.min(300, view.W * (e.deltaY < 0 ? 0.85 : 1.18))); }, { passive: false });
    let pan = null;
    grid.addEventListener('mousedown', (e) => { pan = { x: e.clientX, tEnd: view.tEnd }; view.follow = false; foll.textContent = '⏸ frozen'; });
    window.addEventListener('mouseup', () => { pan = null; });
    grid.addEventListener('mousemove', (e) => { const cell = e.target.closest && e.target.closest('.pl-cell'); if (cell) { const r = cell.querySelector('canvas').getBoundingClientRect(); const frac = (e.clientX - r.left - 32) / (r.width - 36); cursorT = view.tEnd - view.W + frac * view.W; } if (pan) { const r = grid.getBoundingClientRect(); view.tEnd = pan.tEnd - (e.clientX - pan.x) / r.width * view.W; } });

    modalSub = { close: () => { alive = false; cancelAnimationFrame(raf); clearInterval(listIv); for (const t in S.es) S.es[t].close(); if (M) M.style.cssText = savedW; } };
  },
  procmon() {
    const wrap = el('div', {}); openModal('📊 노드 프로세스 (CPU/RSS/스레드 · 라이브)', wrap, () => {});
    const nodes = () => items.filter((i) => i.kind === 'node').map((i) => i.name);
    const draw = async () => {
      const r = await post('/api/resource', { nodes: nodes() });
      const lines = (r.out || '').split('\n').filter((l) => l.trim() && !l.startsWith('('));
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'CPU% 내림차순 · 2초 갱신 · 노드별 kill/restart (독립 프로세스 노드만 값 표시)'));
      const tbl = el('table', { class: 'tbl' }); tbl.append(el('tr', {}, el('th', {}, 'CPU%'), el('th', {}, '노드'), el('th', {}, 'PID'), el('th', {}, 'RSS'), el('th', {}, 'THR'), el('th', {}, '')));
      const seen = new Set();
      lines.forEach((l) => { const m = l.match(/^\s*(\S+)\s+(\S+)\s+pid\s+(\S+)\s+(\S+)\s*MB\s+(\S+)\s*thr/); if (!m) return; const [, cpu, name, pid, rss, thr] = m; seen.add(name);
        const kill = el('button', { class: 'act', onclick: () => post('/api/killnode', { name }).then((rr) => toast('kill ' + name + ': ' + rr.out)) }, 'kill');
        const rest = el('button', { class: 'act', onclick: () => post('/api/restart', { name }).then((rr) => toast('restart ' + name)) }, 'restart');
        tbl.append(el('tr', {}, el('td', { style: 'color:' + (parseFloat(cpu) > 50 ? 'var(--red)' : parseFloat(cpu) > 20 ? 'var(--yellow)' : 'var(--fg)') }, cpu), el('td', { style: 'color:var(--green)' }, name), el('td', {}, pid), el('td', {}, rss + ' MB'), el('td', {}, thr), el('td', {}, kill, ' ', rest))); });
      // 프로세스를 못 찾은 노드도 표시(값 ?) + 액션 제공
      nodes().filter((n) => !seen.has(n)).forEach((name) => { const kill = el('button', { class: 'act', onclick: () => post('/api/killnode', { name }).then((rr) => toast('kill ' + name)) }, 'kill'); const rest = el('button', { class: 'act', onclick: () => post('/api/restart', { name }).then(() => toast('restart ' + name)) }, 'restart'); tbl.append(el('tr', { style: 'opacity:.6' }, el('td', {}, '?'), el('td', { style: 'color:var(--green)' }, name), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, kill, ' ', rest))); });
      wrap.append(tbl);
    };
    draw(); const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
  },
  trigger() {
    const wrap = el('div', {}); openModal('🔴 트리거 녹화 — 조건부 자동 캡처', wrap, () => {});
    const draw = () => { wrap.innerHTML = '';
      const sel = el('select', {}, el('option', { value: 'graph' }, '그래프 ERROR (QoS 불일치 등)'), el('option', { value: 'diag' }, '/diagnostics ERROR')); sel.value = Trigger.cond;
      const btn = el('button', { class: 'act', onclick: () => { if (Trigger.armed) trigDisarm(); else trigArm(sel.value); draw(); } }, Trigger.armed ? '■ 해제' : '● 무장');
      wrap.append(el('div', { class: 'hint', style: 'margin-bottom:8px' }, '조건 발생 시 자동으로 rosbag 캡처(쿨다운 30s). 무장은 모달을 닫아도 유지됩니다.'),
        el('div', { class: 'actbtns' }, el('span', {}, '조건'), sel, btn, el('span', { style: 'color:' + (Trigger.armed ? 'var(--red)' : 'var(--dim)') }, Trigger.armed ? '🔴 무장됨' : '○ 해제됨')));
      wrap.append(el('div', { class: 'sec', style: 'padding-left:0;margin-top:10px' }, '발동 기록'));
      if (!Trigger.log.length) { wrap.append(el('p', { class: 'hint' }, '아직 발동 없음')); return; }
      const tbl = el('table', { class: 'tbl' }); Trigger.log.forEach((l) => tbl.append(el('tr', {}, el('td', {}, l)))); wrap.append(tbl);
    };
    Trigger.onchange = draw; draw();
  },
  teleop() {
    const topic = el('input', { value: '/cmd_vel', style: 'width:150px' });
    const lin = el('input', { type: 'number', value: '0.5', step: '0.1', style: 'width:64px' });
    const ang = el('input', { type: 'number', value: '1.0', step: '0.1', style: 'width:64px' });
    const status = el('span', { class: 'hint' }, '■ 정지');
    let held = null;
    const send = (dx, dz) => { const dir = dx + ',' + dz; if (dir === held) return; held = dir; post('/api/teleop', { topic: topic.value, lin: dx * (+lin.value || 0), ang: dz * (+ang.value || 0) }).then(() => { status.textContent = `▶ ${topic.value}  lin ${(dx * lin.value).toFixed(2)}  ang ${(dz * ang.value).toFixed(2)}`; }); };
    const stop = () => { held = null; post('/api/teleop', { topic: topic.value, stop: true }).then(() => { status.textContent = '■ 정지'; }); };
    const B = (label, dx, dz) => { const b = el('button', { class: 'act', style: 'width:52px;height:44px;font-size:18px' }, label); b.onmousedown = () => send(dx, dz); b.onmouseup = stop; b.onmouseleave = () => { if (held) stop(); }; return b; };
    const stopBtn = el('button', { class: 'act', style: 'width:52px;height:44px;font-size:18px', onclick: stop }, '■');
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(3,52px);gap:6px;justify-content:center;margin:12px 0' },
      el('span'), B('▲', 1, 0), el('span'), B('◀', 0, 1), stopBtn, B('▶', 0, -1), el('span'), B('▼', -1, 0), el('span'));
    openModal('🎮 Teleop (geometry_msgs/Twist)', el('div', {},
      el('div', { class: 'hint', style: 'margin-bottom:6px' }, '토픽 ', topic, '  선속 ', lin, ' m/s  각속 ', ang, ' rad/s'),
      grid, el('div', { class: 'hint' }, '버튼/키를 누르는 동안 -r 10 Hz 발행 · 놓으면 0 트위스트로 정지 · 키보드 W/A/S/D·↑←↓→, Space=정지'), status));
    const KM = { w: [1, 0], ArrowUp: [1, 0], s: [-1, 0], ArrowDown: [-1, 0], a: [0, 1], ArrowLeft: [0, 1], d: [0, -1], ArrowRight: [0, -1] };
    const kd = (e) => { if (!$('#modal').classList.contains('on')) return; if (['INPUT'].includes(document.activeElement.tagName)) return; if (e.key === ' ') { e.preventDefault(); stop(); return; } const m = KM[e.key]; if (m) { e.preventDefault(); send(m[0], m[1]); } };
    const ku = (e) => { if (KM[e.key]) stop(); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    activeModal.close = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); stop(); };
  },
  states(it) {
    const sel = el('select', {}); const cv = el('canvas', { id: 'stcv', width: 900, height: 46, style: 'width:100%;height:52px;background:#0d1116;border:1px solid var(--line);border-radius:4px;margin:6px 0' });
    const leg = el('div', { class: 'fields' }); const cur = el('div', { class: 'hint' });
    openModal('⤳ State Transitions — ' + it.name, el('div', {}, el('div', { class: 'hint' }, '필드 선택 → 값 전이를 시간축 색 밴드로 (enum·bool·문자열에 유용)'), sel, cv, cur, leg));
    const seg = []; let live = null, tt0 = Date.now(); const colors = {}; const PAL = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2', '#e06a6a', '#6f9be0', '#d98a4b']; let fields = [], field = null;
    const draw = () => { const ctx = cv.getContext('2d'); const W = cv.width = cv.clientWidth || 900, H = cv.height; ctx.clearRect(0, 0, W, H); if (!seg.length) return; const tmin = seg[0].t0, tmax = (live ? live.t1 : seg[seg.length - 1].t1) || tmin + 1, span = tmax - tmin || 1;
      for (const s of seg) { const x = (s.t0 - tmin) / span * W, w = Math.max(1.5, (s.t1 - s.t0) / span * W); ctx.fillStyle = colors[s.v] || '#888'; ctx.fillRect(x, 8, w, 30); }
      leg.innerHTML = ''; Object.entries(colors).forEach(([v, c]) => leg.append(el('label', {}, el('span', { style: `display:inline-block;width:11px;height:11px;border-radius:2px;background:${c}` }), ' ' + v))); };
    modalSub = openStream('/echo?topic=' + encodeURIComponent(it.name), (d) => { const lv = leaves(JSON.parse(d));
      if (!fields.length && lv.length) { fields = lv.map((x) => x.path); sel.innerHTML = ''; fields.forEach((f) => sel.append(el('option', { value: f }, f))); field = fields[0]; sel.onchange = () => { field = sel.value; seg.length = 0; live = null; for (const k in colors) delete colors[k]; draw(); }; }
      const f = lv.find((x) => x.path === field); if (!f) return; const v = f.val; const t = (Date.now() - tt0) / 1000; cur.textContent = `현재: ${field} = ${v}`;
      if (live && live.v === v) { live.t1 = t; } else { live = { v, t0: t, t1: t }; seg.push(live); if (!(v in colors)) colors[v] = PAL[Object.keys(colors).length % PAL.length]; if (seg.length > 400) seg.shift(); }
      draw(); });
  },
  async overview() {
    const wrap = el('div', {}); openModal('🩻 시스템 개요', wrap);
    const nodes = items.filter((i) => i.kind === 'node');
    const vtopics = topics().filter((t) => !(t.name || '').includes('/_action/'));
    const stale = vtopics.filter((t) => t.age > 3); const byRate = [...vtopics].sort((a, b) => (b.hz || 0) - (a.hz || 0));
    wrap.append(el('p', {}, `노드 ${nodes.length} · 토픽 ${topics().length} · 서비스 ${items.filter((i) => i.kind === 'service').length}`));
    if (stale.length) wrap.append(el('p', { style: 'color:var(--red)' }, '⚠ stale >3s: ' + stale.map((t) => t.name).join(', ')));
    const res = el('pre', { class: 'out' }, '리소스 수집 중…'); wrap.append(el('h4', {}, '노드 리소스'), res);
    post('/api/resource', { nodes: nodes.map((n) => n.name) }).then((r) => { res.textContent = r.out; });
    const tbl = el('table', { class: 'tbl' }); tbl.append(el('tr', {}, el('th', {}, '토픽'), el('th', {}, 'Hz'))); byRate.slice(0, 12).forEach((t) => tbl.append(el('tr', {}, el('td', {}, t.name), el('td', {}, String(t.hz))))); wrap.append(el('h4', {}, '최고 rate'), tbl);
  },
  async bookmarks() {
    const wrap = el('div', {}); openModal('★ 북마크', wrap);
    const draw = async () => { const r = await api('/api/bookmarks'); const list = r.bookmarks || []; wrap.innerHTML = '';
      const tbl = el('table', { class: 'tbl' });
      list.forEach((b, i) => { const run = el('button', { class: 'act', onclick: () => post('/api/job', { label: b.name, cmd: b.cmd }).then(() => toast('▶ ' + b.name)) }, '실행'); const del = el('button', { class: 'act', onclick: async () => { const nn = list.filter((_, j) => j !== i); await post('/api/bookmarks', { bookmarks: nn }); draw(); } }, '삭제'); tbl.append(el('tr', {}, el('td', {}, '[' + (b.key || '·') + ']'), el('td', {}, b.name), el('td', { style: 'color:var(--dim)' }, b.cmd), el('td', {}, run, ' ', del))); });
      wrap.append(tbl);
      const nm = el('input', { placeholder: '이름' }), cm = el('input', { placeholder: 'cmd', style: 'width:50%' });
      const addb = el('button', { class: 'act', onclick: async () => { const key = String((list.length + 1) % 10); await post('/api/bookmarks', { bookmarks: [...list, { name: nm.value || cm.value, cmd: cm.value, key }] }); draw(); } }, '추가');
      wrap.append(el('div', { class: 'actbtns', style: 'margin-top:8px' }, nm, cm, addb));
    };
    draw();
  },
  jobs() {
    const wrap = el('div', {}); openModal('⚙ Jobs', wrap, () => {});
    const draw = async () => { const r = await api('/api/jobs'); wrap.innerHTML = '';
      const tbl = el('table', { class: 'tbl' });
      (r.jobs || []).forEach((j) => { const kill = el('button', { class: 'act', onclick: () => post(`/api/job/${j.id}/kill`, {}).then(draw) }, 'kill'); tbl.append(el('tr', {}, el('td', {}, el('span', { class: 'badge ' + j.status }, j.status)), el('td', {}, '[' + (j.pid || '?') + '] ' + j.label), el('td', {}, kill))); tbl.append(el('tr', {}, el('td', { colspan: 3 }, el('pre', { class: 'out', style: 'color:var(--dim);max-height:80px' }, (j.log || []).join('\n'))))); });
      wrap.append(tbl); };
    draw(); const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 1500);
  },
};

// ── 툴바 + 키보드 ─────────────────────────────────────────────────────────────
const TOOLS = [['E', '📈 PlotLab', () => Views.plotlab()], ['H', '🩺 Doctor', () => Views.doctor()], ['K', '📌 Baseline', () => Views.baseline()], ['A', '🔴 Trigger', () => Views.trigger()], ['g', '🎮 Teleop', () => Views.teleop()], ['b', '북마크', () => Views.bookmarks()], ['J', 'Jobs', () => Views.jobs()], ['L', '로그', () => Views.log()], ['v', '진단', () => Views.diag()], ['O', '개요', () => Views.overview()], ['P', '📊 프로세스', () => Views.procmon()], ['M', '🗺 Map', () => Views.map()], ['I', '🖼 Cam', () => Views.image()], ['C', '🧊 3D', () => Views.cloud()], ['t', 'TF', () => Views.tftree()]];
const tb = $('#toolbar'); TOOLS.forEach(([k, label, fn]) => tb.append(el('button', { title: k, onclick: fn }, label)));
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'Escape') { closeModal(); return; }
  const t = TOOLS.find((x) => x[0] === e.key); if (t) { t[2](); return; }
  if (!selItem) return;
  if (e.key === 'm' && selItem.kind === 'topic') Views.msgdef(selItem);
  else if (e.key === 'Q' && selItem.kind === 'topic') Views.qos(selItem);
  else if (e.key === 'c') Views.connections(selItem);
  else if (e.key === 'o' && selItem.kind === 'node') Views.params(selItem);
  else if (e.key === 'x') renderValActs();
});

window.addEventListener('resize', paint);
// 그래프 줌(휠, 커서 기준)/팬(빈 곳 드래그) — 노드 드래그는 stopPropagation 으로 분리.
(function graphNav() { const svg = $('#graph'); if (!svg) return;
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const rc = svg.getBoundingClientRect(); const mx = e.clientX - rc.left, my = e.clientY - rc.top; const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const ns = Math.max(0.3, Math.min(4, gview.s * f)); const k = ns / gview.s; gview.ox = mx - (mx - gview.ox) * k; gview.oy = my - (my - gview.oy) * k; gview.s = ns; applyGView(); }, { passive: false });
  let pan = null; svg.addEventListener('mousedown', (e) => { pan = { x: e.clientX, y: e.clientY }; svg.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { if (pan) { pan = null; svg.style.cursor = ''; } });
  svg.addEventListener('mousemove', (e) => { if (!pan) return; gview.ox += e.clientX - pan.x; gview.oy += e.clientY - pan.y; pan = { x: e.clientX, y: e.clientY }; applyGView(); }); })();
requestAnimationFrame(tick);
window.RD = { closeModal, Views };
