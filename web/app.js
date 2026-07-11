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
function tick() {
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600, ids = [...pos.keys()];
  for (const a of ids) { const pa = pos.get(a); for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy || 1, f = 34000 / d2; pa.vx += dx / Math.sqrt(d2) * f * 0.02; pa.vy += dy / Math.sqrt(d2) * f * 0.02; } pa.vx += (W / 2 - pa.x) * 0.0016; pa.vy += (H / 2 - pa.y) * 0.0016; }
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, f = (d - 175) * 0.008; pa.vx += dx / d * f; pa.vy += dy / d * f; pb.vx -= dx / d * f; pb.vy -= dy / d * f; }
  for (const id of ids) { const p = pos.get(id); if (dragging === id) continue; p.x += p.vx *= 0.82; p.y += p.vy *= 0.82; p.x = Math.max(60, Math.min(W - 60, p.x)); p.y = Math.max(28, Math.min(H - 22, p.y)); }
  paint();
  if (!(SNAP && ++tick.n > 420)) requestAnimationFrame(tick);
}
tick.n = 0;
const NS = 'http://www.w3.org/2000/svg';
function paint() {
  const eg = $('#edges'), ng = $('#nodes'); const nb = sel ? neighbors(sel) : null; eg.innerHTML = ''; ng.innerHTML = '';
  for (const e of G.edges) { const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue; const hi = sel && (e.from === sel || e.to === sel);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1;
    const ln = document.createElementNS(NS, 'line'); ln.setAttribute('x1', pa.x + dx / d * 46); ln.setAttribute('y1', pa.y + dy / d * 12); ln.setAttribute('x2', pb.x - dx / d * 46); ln.setAttribute('y2', pb.y - dy / d * 12); ln.setAttribute('class', 'edge' + (hi ? ' hi' : '')); eg.appendChild(ln);
    if (hi || G.edges.length < 26) { const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', (pa.x + pb.x) / 2); tx.setAttribute('y', (pa.y + pb.y) / 2 - 2); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'elabel' + (hi ? ' hi' : '')); tx.textContent = e.topics.length > 1 ? e.topics[0] + ' +' + (e.topics.length - 1) : e.topics[0]; eg.appendChild(tx); } }
  for (const id of pos.keys()) { const p = pos.get(id); const dim = sel && id !== sel && nb && !nb.has(id);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node' + (id === sel ? ' hi' : '') + (dim ? ' dim' : '')); g.setAttribute('transform', `translate(${p.x},${p.y})`);
    const label = id.replace(/^\//, ''); const w = Math.max(60, label.length * 7 + 16);
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
function numeric(text) { const out = {}; const stack = []; for (const raw of text.split('\n')) { if (!raw.trim() || raw.trim() === '---') continue; const ind = raw.length - raw.trimStart().length; const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/); if (!m) continue; const key = m[1], val = m[2].trim(); while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop(); const path = [...stack.map((s) => s.key), key].join('.'); if (val === '') { stack.push({ ind, key }); continue; } if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) out[path] = parseFloat(val); } return out; }
function selectTopic(name) {
  $('#valtitle').textContent = name; sel = name; renderSidebar(); renderValActs();
  if (echoES) echoES.close(); series = {}; order = []; picked = new Set(); t0 = Date.now(); $('#fields').innerHTML = '';
  echoES = new EventSource('/echo?topic=' + encodeURIComponent(name));
  echoES.onmessage = (e) => { const text = JSON.parse(e.data); $('#val').textContent = text.slice(0, 1500);
    const nums = numeric(text), t = (Date.now() - t0) / 1000;
    for (const [k, v] of Object.entries(nums)) { if (!series[k]) { series[k] = []; order.push(k); if (picked.size < 2) picked.add(k); renderFields(); } series[k].push([t, v]); if (series[k].length > 600) series[k].shift(); }
    drawPlot(); };
}
function renderValActs() {
  const box = $('#valacts'); box.innerHTML = ''; const it = selItem; if (!it) return;
  const add = (label, fn) => box.append(el('button', { class: 'act', onclick: fn }, label));
  if (it.kind === 'topic') { add('publish', () => Views.publish(it)); add('msg def', () => Views.msgdef(it)); add('QoS', () => Views.qos(it)); add('connections', () => Views.connections(it)); add(marked.has(it.name) ? 'unmark' : 'mark', () => { marked.has(it.name) ? marked.delete(it.name) : marked.add(it.name); renderSidebar(); renderValActs(); }); }
  if (it.kind === 'service') add('call', () => Views.service(it));
  if (it.kind === 'param') add('set', () => Views.setparam(it));
  if (it.kind === 'node') { add('params', () => Views.params(it)); add('kill', () => post('/api/killnode', { name: it.name }).then((r) => toast(r.out))); add('restart', () => post('/api/restart', { name: it.name }).then((r) => toast(r.out))); add('lifecycle', () => Views.lifecycle(it)); add('connections', () => Views.connections(it)); }
  if (it.kind === 'action') add('send goal', () => Views.action(it));
}
function renderFields() { const f = $('#fields'); f.innerHTML = ''; order.forEach((k) => { const c = el('input', { type: 'checkbox', 'data-k': k }); c.checked = picked.has(k); c.onchange = () => { c.checked ? picked.add(k) : picked.delete(k); drawPlot(); }; f.append(el('label', {}, c, k)); }); }
function drawPlot() { const cv = $('#plot'), ctx = cv.getContext('2d'); const W = cv.width = cv.clientWidth, Hh = cv.height; ctx.clearRect(0, 0, W, Hh); const keys = [...picked].filter((k) => series[k] && series[k].length > 1); if (!keys.length) return; let mn = Infinity, mx = -Infinity, tmin = Infinity, tmax = -Infinity; for (const k of keys) for (const [t, v] of series[k]) { if (v < mn) mn = v; if (v > mx) mx = v; if (t < tmin) tmin = t; if (t > tmax) tmax = t; } if (mx - mn < 1e-9) { mx += 1; mn -= 1; } const cols = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2']; keys.forEach((k, ci) => { ctx.strokeStyle = cols[ci % cols.length]; ctx.lineWidth = 1.4; ctx.beginPath(); series[k].forEach(([t, v], i) => { const x = (t - tmin) / (tmax - tmin || 1) * (W - 8) + 4, y = Hh - 6 - (v - mn) / (mx - mn) * (Hh - 14); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.fillStyle = cols[ci % cols.length]; ctx.fillText(k, 6, 12 + ci * 12); }); }

// ── 모달 ───────────────────────────────────────────────────────────────────
let activeModal = null;
function openModal(title, node, refresh) { $('#mtitle').textContent = title; const b = $('#mbody'); b.innerHTML = ''; b.append(node); $('#modal').classList.add('on'); activeModal = { refresh, close: () => {} }; }
function closeModal() { $('#modal').classList.remove('on'); if (modalSub) { modalSub.close(); modalSub = null; } activeModal = null; }
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
const TOOLS = [['b', '북마크', () => Views.bookmarks()], ['J', 'Jobs', () => Views.jobs()], ['L', '로그', () => Views.log()], ['v', '진단', () => Views.diag()], ['O', '개요', () => Views.overview()], ['t', 'TF', () => Views.tftree()]];
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
