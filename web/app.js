/* RDash 웹 프론트엔드 — TUI 기능을 브라우저 GUI 로. 백엔드(web/server.js) API 를 호출/구독한다. */
'use strict';
const $ = (s) => document.querySelector(s);
const el = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else if (k.startsWith('on')) e[k] = a[k]; else e.setAttribute(k, a[k]); } for (const c of kids) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const api = (u, opt) => fetch(u, opt).then((r) => r.json());
const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const SNAP = location.search.includes('snap');

let items = [], ver = '?', sel = null, selItem = null, marked = new Set();
api('/api/ver').then((o) => { ver = o.ver; $('#verlbl').textContent = 'ROS' + ver + ' · localhost'; });

// ── 텔레메트리 SSE ──────────────────────────────────────────────────────────
const es = new EventSource('/events');
es.onopen = () => { $('#conn').textContent = '● 연결됨'; };
es.onerror = () => { $('#conn').textContent = '× 연결 끊김'; };
es.onmessage = (e) => { try { const o = JSON.parse(e.data); if (o.items) { items = o.items; render(); } } catch (_) { /* */ } };

const nodeName = (e) => (Array.isArray(e) ? e[0] : e);
const byName = (n) => items.find((i) => i.name === n);
const topics = () => items.filter((i) => i.kind === 'topic');
const visible = () => items.filter((i) => !(i.name || '').includes('/_action/'));

// ── 노드 그래프 — rqt_graph 스타일(노드/토픽 이분 그래프) + 서비스·액션 관계 ──────────
let G = { ents: new Map(), edges: [] }, pos = new Map(), dragging = null;
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
    g.onmousedown = (ev) => { dragging = id; selectNode(id); if (e.type === 'topic') selectTopic(id); const mv = (m) => { const rc = $('#graph').getBoundingClientRect(); const pp = pos.get(id); pp.x = m.clientX - rc.left; pp.y = m.clientY - rc.top; }; const up = () => { dragging = null; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); ev.preventDefault(); };
    ng.appendChild(g); }
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
  const side = $('#side'); side.innerHTML = ''; H.forEach((x) => side.append(x));
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
  echoES = new EventSource('/echo?topic=' + encodeURIComponent(name));
  echoES.onmessage = (e) => { const text = JSON.parse(e.data); $('#val').textContent = text.slice(0, 1500);
    const nums = numeric(text), t = (Date.now() - t0) / 1000;
    for (const [k, v] of Object.entries(nums)) { if (!series[k]) { series[k] = []; order.push(k); if (picked.size < 2) picked.add(k); renderFields(); } series[k].push([t, v]); if (series[k].length > 600) series[k].shift(); }
    drawPlot(); drawGauge(); };
}
function renderValActs() {
  const box = $('#valacts'); box.innerHTML = ''; const it = selItem; if (!it) return;
  const add = (label, fn) => box.append(el('button', { class: 'act', onclick: fn }, label));
  if (it.kind === 'topic') { add('publish', () => Views.publish(it)); add('states', () => Views.states(it));
    if ((it.ty || '').includes('NavSatFix')) add('🗺 map', () => Views.map(it));
    if ((it.ty || '').includes('CompressedImage') || (it.ty || '').includes('sensor_msgs/msg/Image')) add('🖼 image', () => Views.image(it));
    if ((it.ty || '').includes('PointCloud2')) add('🧊 3D', () => Views.cloud(it));
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
  if (cond === 'diag') { Trigger.es = new EventSource('/diagnostics'); Trigger.es.onmessage = (e) => { try { if (/level:\s*2/.test(JSON.parse(e.data))) trigFire('/diagnostics ERROR'); } catch (_) { /* */ } }; }
  else { Trigger.iv = setInterval(() => { const errs = diagnose(items).issues.filter((i) => i.sev === 0); if (errs.length) trigFire('그래프 ERROR: ' + errs[0].target); }, 2000); }
  trigBadge();
}

// ── WebGL 포인트클라우드 렌더러 — 의존성 없는 raw WebGL. 대량 포인트·부드러운 회전/줌/이동 ──
function mkCloudGL(cv, info) {
  const gl = cv.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: SNAP }) || cv.getContext('experimental-webgl');
  if (!gl) { info.textContent = 'WebGL 미지원 브라우저'; return { setPoints() {}, setPointSize() {}, dispose() {} }; }
  const VS = 'attribute vec3 p; uniform mat4 mvp; uniform vec2 zr; uniform float psize; varying float h;'
    + 'void main(){ gl_Position = mvp*vec4(p,1.0); gl_PointSize = psize; h = clamp((p.z-zr.x)/max(zr.y-zr.x,0.001),0.0,1.0); }';
  const FS = 'precision mediump float; varying float h;'
    + 'void main(){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard;'
    + ' vec3 lo=vec3(0.20,0.66,0.87), mid=vec3(0.44,0.82,0.55), hi=vec3(0.90,0.80,0.32);'
    + ' vec3 c = h<0.5 ? mix(lo,mid,h*2.0) : mix(mid,hi,(h-0.5)*2.0); gl_FragColor=vec4(c,1.0); }';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'p'), uMVP = gl.getUniformLocation(prog, 'mvp'), uZR = gl.getUniformLocation(prog, 'zr'), uPS = gl.getUniformLocation(prog, 'psize');
  const buf = gl.createBuffer(); gl.enableVertexAttribArray(aP);
  gl.clearColor(0.043, 0.055, 0.071, 1); gl.enable(gl.DEPTH_TEST);
  let N = 0, yaw = 0.6, pitch = -0.5, dist = 6, center = [0, 0, 0], zr = [0, 1], psize = 2.4, pan = [0, 0], raf = 0, alive = true, fitted = false;
  const perspective = (fov, asp, near, far) => { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; };
  const mul = (a, b) => { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  function mvpMat() {
    const asp = (cv.clientWidth || 900) / (cv.clientHeight || 520);
    const P = perspective(45 * Math.PI / 180, asp, 0.05, 5000);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Ryaw = [cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const Rpit = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -center[0] + pan[0], -center[1], -center[2] + pan[1], 1];
    const V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1];
    return mul(P, mul(V, mul(Rpit, mul(Ryaw, T))));
  }
  function draw() {
    const W = cv.clientWidth || 900, H = cv.clientHeight || 520; if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!N) return;
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvpMat())); gl.uniform2f(uZR, zr[0], zr[1]); gl.uniform1f(uPS, psize);
    gl.drawArrays(gl.POINTS, 0, N);
  }
  let drag = null, btn = 0;
  cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; btn = e.button; cv.style.cursor = 'grabbing'; e.preventDefault(); });
  window.addEventListener('mouseup', () => { drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (btn === 2) { pan[0] += dx * dist * 0.002; pan[1] -= dy * dist * 0.002; } else { yaw += dx * 0.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * 0.01)); } });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dist *= e.deltaY < 0 ? 0.9 : 1.1; }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  function loop() { if (!alive) return; draw(); if (!(SNAP && ++loop.n > 240)) raf = requestAnimationFrame(loop); }
  loop.n = 0; loop();
  return {
    setPoints(pts) { N = pts.length / 3 | 0; if (!N) return; let cx = 0, cy = 0, cz = 0, mnz = Infinity, mxz = -Infinity, mr = 0;
      for (let i = 0; i < N; i++) { cx += pts[i * 3]; cy += pts[i * 3 + 1]; cz += pts[i * 3 + 2]; } cx /= N; cy /= N; cz /= N;
      for (let i = 0; i < N; i++) { const z = pts[i * 3 + 2]; if (z < mnz) mnz = z; if (z > mxz) mxz = z; const r = Math.hypot(pts[i * 3] - cx, pts[i * 3 + 1] - cy, z - cz); if (r > mr) mr = r; }
      center = [cx, cy, cz]; zr = [mnz, mxz]; if (!fitted) { dist = (mr * 2.6) || 6; fitted = true; }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
      info.textContent = `${N} 점 · WebGL · 드래그 회전 · 휠 줌 · 우클릭 이동`;
    },
    setPointSize(s) { psize = s; },
    dispose() { alive = false; cancelAnimationFrame(raf); try { gl.deleteBuffer(buf); gl.deleteProgram(prog); } catch (_) { /* */ } },
  };
}

// ── 모달 ───────────────────────────────────────────────────────────────────
let activeModal = null;
function openModal(title, node, refresh) { $('#mtitle').textContent = title; const b = $('#mbody'); b.innerHTML = ''; b.append(node); $('#modal').classList.add('on'); activeModal = { refresh, close: () => {} }; }
function closeModal() { $('#modal').classList.remove('on'); if (activeModal && activeModal.close) { try { activeModal.close(); } catch (_) { /* */ } } if (modalSub) { modalSub.close(); modalSub = null; } activeModal = null; }
let modalSub = null;   // 모달이 연 SSE
function toast(msg) { $('#conn').textContent = String(msg).slice(0, 60); }

// ── 뷰들 ───────────────────────────────────────────────────────────────────
const Views = {
  async msgdef(it) { const pre = el('pre', { class: 'out' }, '조회 중…'); openModal('📄 ' + (it.ty || it.name), pre); const r = await api('/api/msgdef?type=' + encodeURIComponent(it.ty || '')); pre.textContent = r.out || '(없음)'; },
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
  async connections(it) { const pre = el('pre', { class: 'out' }, '조회 중…'); openModal('🔗 ' + it.name, pre); const r = await api(`/api/connections?kind=${it.kind}&name=${encodeURIComponent(it.name)}`); pre.textContent = r.out; },
  async tftree() { const pre = el('pre', { class: 'out' }, '/tf 수집 중…'); openModal('🌳 TF tree', pre); const r = await api('/api/tftree'); pre.textContent = r.out; },
  publish(it) { this._msgForm('▲ publish — ' + it.name, '/api/publish', { name: it.name }, 'msg', '/api/proto?name=' + encodeURIComponent(it.name) + '&type=' + encodeURIComponent(it.ty || '')); },
  service(it) { this._msgForm('call service — ' + it.name, '/api/service', { name: it.name }, 'req'); },
  action(it) { const ta = el('textarea', { rows: 4, style: 'width:100%', html: '{}' }); const out = el('pre', { class: 'out' }); const btn = el('button', { class: 'act', onclick: async () => { const r = await post('/api/action', { name: it.name, type: it.ty || '', goal: ta.value }); out.textContent = 'goal 전송 (job ' + r.id + ') — Jobs 에서 피드백'; } }, 'send goal'); openModal('🎯 action goal — ' + it.name, el('div', {}, el('div', { class: 'hint' }, 'goal (YAML)'), ta, el('div', { class: 'actbtns' }, btn), out)); },
  _msgForm(title, url, base, key, protoUrl) { const ta = el('textarea', { rows: 5, style: 'width:100%', html: '{}' }); const out = el('pre', { class: 'out' }); const btn = el('button', { class: 'act', onclick: async () => { out.textContent = '전송 중…'; const r = await post(url, { ...base, [key]: ta.value }); out.textContent = r.out; } }, '전송'); openModal(title, el('div', {}, el('div', { class: 'hint' }, key + ' (YAML/JSON)'), ta, el('div', { class: 'actbtns' }, btn), out)); if (protoUrl) api(protoUrl).then((r) => { if (r && r.yaml && ta.value.trim() === '{}') ta.value = r.yaml; }).catch(() => {}); },
  setparam(it) { const inp = el('input', { style: 'width:100%', value: '' }); const out = el('pre', { class: 'out' }); openModal('set param — ' + it.name, el('div', {}, inp, el('div', { class: 'actbtns' }, el('button', { class: 'act', onclick: async () => { const r = await post('/api/setparam1', { name: it.name, value: inp.value }); out.textContent = r.out; } }, '적용')), out)); },
  async params(it) {
    const wrap = el('div', {}, '조회 중…'); openModal('⚙ params — ' + it.name, wrap);
    const r = await api('/api/param/list?node=' + encodeURIComponent(it.name)); wrap.innerHTML = '';
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
    const s = new EventSource(endpoint); modalSub = s;
    s.onmessage = (e) => { const blk = JSON.parse(e.data); for (const r of parse(blk)) { rows.push(r); if (rows.length > 1000) rows.shift(); } rerender(); };
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
    const save = async () => { await post('/api/baseline', { profile: { ...snapProfile(items), at: Date.now() } }); base = (await api('/api/baseline')).baseline; draw(); toast('📌 기준선 저장'); };
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
    // 🧊 3D 포인트클라우드 — float32 xyz SSE 를 WebGL 로 렌더(대량 포인트·부드러운 회전, 의존성 없음).
    const topic = it ? it.name : (items.find((i) => (i.ty || '').includes('PointCloud2')) || {}).name;
    if (!topic) { openModal('🧊 3D 포인트클라우드', el('p', { class: 'hint' }, 'PointCloud2 토픽이 없습니다.')); return; }
    const cv = el('canvas', { width: 900, height: 520, style: 'width:100%;height:520px;background:#0b0e12;border:1px solid var(--line);border-radius:6px;cursor:grab;display:block' });
    const info = el('div', { class: 'hint', style: 'margin-top:6px' }, '연결 중…');
    const ptSize = el('input', { type: 'range', min: '1', max: '6', value: '2.4', step: '0.2', style: 'vertical-align:middle' });
    openModal('🧊 3D — ' + topic, el('div', {}, el('div', { class: 'hint', style: 'margin-bottom:6px' }, '드래그=회전 · 휠=줌 · 우클릭드래그=이동 · 높이(z) 색상 · WebGL · 점크기 ', ptSize), cv, info));
    const cloud3d = mkCloudGL(cv, info);
    ptSize.oninput = () => cloud3d.setPointSize(+ptSize.value);
    const es = new EventSource('/cloudstream?topic=' + encodeURIComponent(topic));
    es.onmessage = (e) => { if (!e.data) return; const bin = atob(e.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); cloud3d.setPoints(new Float32Array(u8.buffer)); };
    es.onerror = () => { info.textContent = '스트림 오류 — PointCloud2 토픽 확인'; };
    modalSub = { close: () => { es.close(); cloud3d.dispose(); } };
  },
  image(it) {
    // 🖼 카메라 — CompressedImage/Image 프레임을 base64 JPEG SSE 로 받아 표시.
    const topic = it ? it.name : (items.find((i) => /CompressedImage|sensor_msgs\/msg\/Image/.test(i.ty || '')) || {}).name;
    if (!topic) { openModal('🖼 카메라', el('p', { class: 'hint' }, '이미지 토픽이 없습니다.')); return; }
    const img = el('img', { style: 'max-width:100%;display:block;background:#0d1116;border:1px solid var(--line);border-radius:6px;image-rendering:auto' });
    const info = el('div', { class: 'hint', style: 'margin-top:6px' }, '연결 중…'); let n = 0, t0 = Date.now();
    openModal('🖼 카메라 — ' + topic, el('div', {}, img, info));
    const es = new EventSource('/imgstream?topic=' + encodeURIComponent(topic)); modalSub = es;
    es.onmessage = (e) => { if (!e.data) return; img.src = 'data:image/jpeg;base64,' + e.data; n++; const fps = n / ((Date.now() - t0) / 1000); info.textContent = `${n} 프레임 · ${fps.toFixed(1)} fps`; };
    es.onerror = () => { info.textContent = '스트림 오류 — image_transport/토픽 확인'; };
  },
  map(it) {
    // 🗺 GPS 지도 — NavSatFix lat/lon 궤적을 캔버스에 플롯(외부 타일 없이, 오프라인/CSP 안전).
    const topic = it ? it.name : (items.find((i) => (i.ty || '').includes('NavSatFix')) || {}).name;
    if (!topic) { openModal('🗺 GPS 지도', el('p', { class: 'hint' }, 'NavSatFix 토픽이 없습니다.')); return; }
    const cv = el('canvas', { width: 900, height: 460, style: 'width:100%;height:460px;background:#0d1116;border:1px solid var(--line);border-radius:6px' });
    const info = el('div', { class: 'hint', style: 'margin-top:6px' });
    openModal('🗺 GPS 지도 — ' + topic, el('div', {}, el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'NavSatFix 위경도 궤적 (외부 타일 없이 로컬 렌더)'), cv, info));
    const track = []; let cur = null;
    const es = new EventSource('/echo?topic=' + encodeURIComponent(topic)); modalSub = es;
    es.onmessage = (e) => { const text = JSON.parse(e.data); const g = {};
      for (const m of text.matchAll(/^(latitude|longitude|altitude):\s*(-?\d+\.?\d*)/gm)) g[m[1]] = parseFloat(m[2]);
      if (g.latitude == null || g.longitude == null) return;
      cur = g; track.push([g.longitude, g.latitude]); if (track.length > 2000) track.shift();
      info.textContent = `lat ${g.latitude.toFixed(6)} · lon ${g.longitude.toFixed(6)} · alt ${(g.altitude ?? 0).toFixed(1)} m · ${track.length} pts`;
      draw(); };
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
    const sub = (topic) => { if (S.es[topic] || S.bag.has(topic)) return; const es = new EventSource('/echo?topic=' + encodeURIComponent(topic));
      es.onmessage = (e) => { let text; try { text = JSON.parse(e.data); } catch (_) { return; } const nums = numeric(text); const t = (Date.now() - S.t0) / 1000; S.fields[topic] = Object.keys(nums);
        for (const [k, v] of Object.entries(nums)) { const key = topic + ' ' + k; (S.series[key] || (S.series[key] = [])).push([t, v]); if (S.series[key].length > 4000) S.series[key].shift(); } };
      S.es[topic] = es; };
    const view = { W: 10, follow: true, tEnd: 0 }; const plots = []; let colorI = 0, cursorT = null;
    const TF = { raw: '원값', deriv: 'd/dt', integ: '∫dt', abs: '|x|', movavg: '이동평균' };
    const applyT = (data, tf) => { if (!data || data.length < 2 || tf === 'raw') return data || [];
      if (tf === 'deriv') { const o = []; for (let i = 1; i < data.length; i++) { const dt = data[i][0] - data[i - 1][0] || 1e-6; o.push([data[i][0], (data[i][1] - data[i - 1][1]) / dt]); } return o; }
      if (tf === 'integ') { const o = []; let a = 0; for (let i = 1; i < data.length; i++) { a += (data[i][1] + data[i - 1][1]) / 2 * (data[i][0] - data[i - 1][0]); o.push([data[i][0], a]); } return o; }
      if (tf === 'abs') return data.map(([t, v]) => [t, Math.abs(v)]);
      if (tf === 'movavg') { const n = 12, q = []; let s = 0; const o = []; for (const [t, v] of data) { q.push(v); s += v; if (q.length > n) s -= q.shift(); o.push([t, s / q.length]); } return o; }
      return data; };
    const latestT = () => { let m = 0; for (const k in S.series) { const a = S.series[k]; if (a.length) m = Math.max(m, a[a.length - 1][0]); } return m; };

    const list = el('div', { class: 'pl-list' }), grid = el('div', { class: 'pl-grid' }), win = el('span', { class: 'hint' });
    const foll = el('button', { class: 'act', onclick: () => { view.follow = !view.follow; foll.textContent = view.follow ? '▶ follow' : '⏸ frozen'; } }, '▶ follow');
    const bar = el('div', { class: 'pl-bar' },
      el('button', { class: 'act', onclick: () => addPlot() }, '+ 플롯'),
      el('button', { class: 'act', onclick: () => { grid.style.gridTemplateColumns = '1fr'; } }, '≡ 세로'),
      el('button', { class: 'act', onclick: () => { grid.style.gridTemplateColumns = '1fr 1fr'; } }, '⊞ 격자'),
      el('span', { class: 'hint' }, '창'), ...[5, 10, 30].map((w) => el('button', { class: 'act', onclick: () => { view.W = w; } }, w + 's')),
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
    function addPlot() {
      const canvas = el('canvas', { class: 'pl-canvas' }), legend = el('div', { class: 'pl-legend' }), cell = el('div', { class: 'pl-cell' });
      const plot = { curves: [], canvas, legend, cell };
      const drawLegend = () => { legend.innerHTML = '';
        const xyBtn = el('span', { class: 'pl-btn2' + (plot.xy ? ' on' : ''), title: 'XY 플롯(c0=X)', onclick: () => { plot.xy = !plot.xy; drawLegend(); } }, 'XY');
        const fxBtn = el('span', { class: 'pl-btn2', title: '커스텀 수식 커브', onclick: () => { plot._fx = !plot._fx; drawLegend(); } }, 'ƒ');
        legend.append(el('span', { class: 'pl-cv' }, xyBtn, fxBtn));
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
      cell.append(canvas, legend, el('button', { class: 'pl-x', onclick: () => { const i = plots.indexOf(plot); if (i >= 0) plots.splice(i, 1); cell.remove(); } }, '✕'));
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
    const es = new EventSource('/echo?topic=' + encodeURIComponent(it.name)); modalSub = es;
    es.onmessage = (e) => { const lv = leaves(JSON.parse(e.data));
      if (!fields.length && lv.length) { fields = lv.map((x) => x.path); sel.innerHTML = ''; fields.forEach((f) => sel.append(el('option', { value: f }, f))); field = fields[0]; sel.onchange = () => { field = sel.value; seg.length = 0; live = null; for (const k in colors) delete colors[k]; draw(); }; }
      const f = lv.find((x) => x.path === field); if (!f) return; const v = f.val; const t = (Date.now() - tt0) / 1000; cur.textContent = `현재: ${field} = ${v}`;
      if (live && live.v === v) { live.t1 = t; } else { live = { v, t0: t, t1: t }; seg.push(live); if (!(v in colors)) colors[v] = PAL[Object.keys(colors).length % PAL.length]; if (seg.length > 400) seg.shift(); }
      draw(); };
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
requestAnimationFrame(tick);
window.RD = { closeModal, Views };
