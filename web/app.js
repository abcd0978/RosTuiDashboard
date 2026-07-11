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

// ── 노드 그래프(포스 레이아웃) ────────────────────────────────────────────────
let G = { nodes: [], edges: [] }, pos = new Map(), dragging = null;
function buildGraph() {
  const nodeSet = new Set(items.filter((i) => i.kind === 'node').map((i) => i.name));
  const edges = new Map();
  for (const t of topics()) {
    const pubs = (t.pubs || []).map(nodeName), subs = (t.subs || []).map(nodeName);
    pubs.forEach((p) => nodeSet.add(p)); subs.forEach((s) => nodeSet.add(s));
    for (const p of pubs) for (const s of subs) { if (p === s) continue; const k = p + '\0' + s; if (!edges.has(k)) edges.set(k, new Set()); edges.get(k).add(t.name); }
  }
  return { nodes: [...nodeSet], edges: [...edges].map(([k, ts]) => ({ from: k.split('\0')[0], to: k.split('\0')[1], topics: [...ts] })) };
}
function render() {
  const g = buildGraph();
  const t = topics().length, n = items.filter((i) => i.kind === 'node').length, s = items.filter((i) => i.kind === 'service').length;
  $('#counts').textContent = `노드 ${n} · 토픽 ${t} · 서비스 ${s}`;
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600;
  for (const id of g.nodes) if (!pos.has(id)) pos.set(id, { x: W / 2 + (Math.random() - .5) * 220, y: H / 2 + (Math.random() - .5) * 220, vx: 0, vy: 0 });
  for (const id of [...pos.keys()]) if (!g.nodes.includes(id)) pos.delete(id);
  G = g; renderSidebar(); if (activeModal) activeModal.refresh && activeModal.refresh();
}
function neighbors(id) { const s = new Set(); for (const e of G.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); } return s; }
const HALF_H = 11, GAP = 18;                              // 노드 높이 절반 · 충돌 여백
const nodeW = (id) => Math.max(64, id.replace(/^\//, '').length * 7 + 18);
const halfW = (id) => nodeW(id) / 2;
// 사각형 경계와 중심→방향 직선의 교점 — 화살표가 박스 테두리에 딱 붙게(겹침 방지).
function borderPt(p, hw, hh, dx, dy) { const s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-6); return { x: p.x + dx * s, y: p.y + dy * s }; }
function tick() {
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600, ids = [...pos.keys()];
  // 척력(Coulomb) — 넉넉하게 밀어 노드가 서로 안 겹치게.
  for (const a of ids) { const pa = pos.get(a); for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy || 1, f = 95000 / d2, d = Math.sqrt(d2); pa.vx += dx / d * f * 0.02; pa.vy += dy / d * f * 0.02; } pa.vx += (W / 2 - pa.x) * 0.0012; pa.vy += (H / 2 - pa.y) * 0.0018; }
  // 인력(스프링) — 연결 노드는 적당한 거리로, 토픽 수(가중치)가 많을수록 살짝 더 가깝게.
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, ideal = 210 - Math.min(60, e.topics.length * 8), f = (d - ideal) * 0.009; pa.vx += dx / d * f; pa.vy += dy / d * f; pb.vx -= dx / d * f; pb.vy -= dy / d * f; }
  for (const id of ids) { const p = pos.get(id); if (dragging === id) continue; p.x += p.vx *= 0.82; p.y += p.vy *= 0.82; }
  // 충돌 해소(위치 직접 분리) — 겹치는 사각형을 침투 적은 축으로 밀어냄. 라벨 겹침도 크게 줄어듦.
  for (let it = 0; it < 2; it++) for (const a of ids) { if (dragging === a) continue; const pa = pos.get(a); for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pb.x - pa.x, dy = pb.y - pa.y; const minX = halfW(a) + halfW(b) + GAP, minY = 2 * HALF_H + GAP; const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy); if (ox > 0 && oy > 0) { if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; pa.x -= s; if (dragging !== b) pb.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; pa.y -= s; if (dragging !== b) pb.y += s; } } } }
  for (const id of ids) { const p = pos.get(id); p.x = Math.max(halfW(id) + 4, Math.min(W - halfW(id) - 4, p.x)); p.y = Math.max(HALF_H + 4, Math.min(H - HALF_H - 4, p.y)); }
  paint();
  if (!(SNAP && ++tick.n > 480)) requestAnimationFrame(tick);
}
tick.n = 0;
const NS = 'http://www.w3.org/2000/svg';
function paint() {
  const eg = $('#edges'), ng = $('#nodes'); const nb = sel ? neighbors(sel) : null; eg.innerHTML = ''; ng.innerHTML = '';
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const hi = sel && (e.from === sel || e.to === sel); const cnt = e.topics.length;
    const dx = pb.x - pa.x, dy = pb.y - pa.y; const s = borderPt(pa, halfW(e.from) + 3, HALF_H + 3, dx, dy), t = borderPt(pb, halfW(e.to) + 8, HALF_H + 8, -dx, -dy);
    const ln = document.createElementNS(NS, 'line'); ln.setAttribute('x1', s.x); ln.setAttribute('y1', s.y); ln.setAttribute('x2', t.x); ln.setAttribute('y2', t.y); ln.setAttribute('class', 'edge' + (hi ? ' hi' : '')); ln.setAttribute('stroke-width', Math.min(5, 1.1 + cnt * 0.7)); const ti = document.createElementNS(NS, 'title'); ti.textContent = e.topics.join('\n'); ln.appendChild(ti); eg.appendChild(ln);
    // 라벨 = 토픽 개수(가중치)만. 노드/엣지 위 겹침을 줄이려 중점에서 법선방향으로 살짝 띄움.
    const d = Math.hypot(dx, dy) || 1; const mx = (s.x + t.x) / 2 - dy / d * 7, my = (s.y + t.y) / 2 + dx / d * 7;
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', mx); tx.setAttribute('y', my + 3); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'elabel' + (hi ? ' hi' : '')); tx.textContent = cnt; const t2 = document.createElementNS(NS, 'title'); t2.textContent = e.topics.join('\n'); tx.appendChild(t2); eg.appendChild(tx); }
  for (const id of pos.keys()) { const p = pos.get(id); const dim = sel && id !== sel && nb && !nb.has(id);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node' + (id === sel ? ' hi' : '') + (dim ? ' dim' : '')); g.setAttribute('transform', `translate(${p.x},${p.y})`);
    const label = id.replace(/^\//, ''); const w = nodeW(id);
    const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', -w / 2); r.setAttribute('y', -11); r.setAttribute('width', w); r.setAttribute('height', 22); g.appendChild(r);
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('y', 4); tx.textContent = label; g.appendChild(tx);
    g.onmousedown = (ev) => { dragging = id; selectNode(id); const mv = (m) => { const rc = $('#graph').getBoundingClientRect(); const pp = pos.get(id); pp.x = m.clientX - rc.left; pp.y = m.clientY - rc.top; }; const up = () => { dragging = null; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); ev.preventDefault(); };
    ng.appendChild(g); }
}
function selectNode(id) { sel = id; selItem = byName(id) || { kind: 'node', name: id }; renderSidebar(); }

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
  if (it.kind === 'topic') { add('publish', () => Views.publish(it)); add('states', () => Views.states(it)); add('msg def', () => Views.msgdef(it)); add('QoS', () => Views.qos(it)); add('connections', () => Views.connections(it)); add(marked.has(it.name) ? 'unmark' : 'mark', () => { marked.has(it.name) ? marked.delete(it.name) : marked.add(it.name); renderSidebar(); renderValActs(); }); }
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
const TOOLS = [['H', '🩺 Doctor', () => Views.doctor()], ['K', '📌 Baseline', () => Views.baseline()], ['g', '🎮 Teleop', () => Views.teleop()], ['b', '북마크', () => Views.bookmarks()], ['J', 'Jobs', () => Views.jobs()], ['L', '로그', () => Views.log()], ['v', '진단', () => Views.diag()], ['O', '개요', () => Views.overview()], ['t', 'TF', () => Views.tftree()]];
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
