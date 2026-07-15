/* 노드 그래프 — rqt_graph 스타일(노드/토픽 이분 그래프) + 서비스·액션 관계 */

import { $, el, api, SNAP } from '../lib/dom.js';
import { state, byName, isAnon, nodeName } from '../lib/state.js';
import { getActiveModal } from '../lib/modal.js';
import { renderSidebar } from '../panels/sidebar.js';
import { renderInfo } from '../panels/info.js';
import { renderValActs, clearNonTopicSelection, selectTopic } from '../panels/value.js';
import { openEdgeModal } from './edge.js';
import { aggregateTopicEdges } from '../lib/graphedges.js';

let G = { ents: new Map(), edges: [] }, pos = new Map(), dragging = null, hoverEdge = null;
let gspread = 1;                        // 노드 간격 배수(슬라이더로 실시간 조절) — 척력·스프링·충돌 간격에 반영
let hoverTarget = null;                 // { kind:'topic'|'node', name } | null — 정보 패널 호버로 그래프에 임시 하이라이트(state.sel은 안 건드림)

// 정보 패널에서 토픽/노드 이름에 마우스를 올리면 그래프에 임시로 하이라이트한다. setGraphHover(null) 로 해제.
export function setGraphHover(kind, name) { hoverTarget = kind ? { kind, name } : null; }

export const gview = { s: 1, ox: 0, oy: 0 };   // 그래프 줌/팬(#edges·#nodes 그룹 transform)

export function applyGView() {
  const tr = `translate(${gview.ox},${gview.oy}) scale(${gview.s})`;
  const e = $('#edges'), n = $('#nodes');
  if (e) e.setAttribute('transform', tr);
  if (n) n.setAttribute('transform', tr);
}

// 화면좌표 → 그래프좌표(줌/팬 역변환).
function toGraph(clientX, clientY) {
  const rc = $('#graph').getBoundingClientRect();
  return { x: (clientX - rc.left - gview.ox) / gview.s, y: (clientY - rc.top - gview.oy) / gview.s };
}

let GMODE = 'nodes';                                    // 'nodes'(노드만) | 'bipartite'(노드+토픽)
const GF = { debug: false, tf: true, services: true, actions: true, leaves: true, anon: false };   // 표시 필터(anon=CLI/도구 노드 표시)

function isDebug(n) { return n === '/rosout' || n === '/rosout_agg' || n === '/parameter_events'; }
function isTf(n) { return n === '/tf' || n === '/tf_static'; }

function keepNode(n) { return GF.anon || !isAnon(n); }

// 숨은 /_action/ 토픽 → 액션별 서버/클라이언트 노드
function actionGroups() {
  const m = new Map();
  for (const t of state.items) {
    if (t.kind !== 'topic') continue;
    const mm = /^(.*)\/_action\/(feedback|status|goal|result|cancel_goal)/.exec(t.name);
    if (!mm) continue;
    const a = mm[1], srv = /feedback|status|result/.test(mm[2]);
    if (!m.has(a)) m.set(a, { servers: new Set(), clients: new Set() });
    const g = m.get(a);
    (t.pubs || []).map(nodeName).forEach((p) => (srv ? g.servers : g.clients).add(p));
    (t.subs || []).map(nodeName).forEach((s) => (srv ? g.clients : g.servers).add(s));
  }
  return m;
}

export function buildGraph() {
  const ents = new Map(), edges = [];
  const ent = (name, type) => { if (!ents.has(name)) ents.set(name, { name, type }); };
  for (const i of state.items) if (i.kind === 'node' && keepNode(i.name)) ent(i.name, 'node');
  const realTopics = state.items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')
    && (GF.debug || !isDebug(i.name)) && (GF.tf || !isTf(i.name)));
  if (GMODE === 'bipartite') {
    for (const t of realTopics) {
      const pubs = (t.pubs || []).map(nodeName).filter(keepNode), subs = (t.subs || []).map(nodeName).filter(keepNode);
      if (!GF.leaves && !(pubs.length && subs.length)) continue;
      pubs.forEach((p) => ent(p, 'node'));
      subs.forEach((s) => ent(s, 'node'));
      ent(t.name, 'topic');
      pubs.forEach((p) => edges.push({ from: p, to: t.name, kind: 'pub' }));
      subs.forEach((s) => edges.push({ from: t.name, to: s, kind: 'sub' }));
    }
  } else {
    // 무방향 쌍으로 집계 — 양방향 통신도 엣지 하나, 방향은 토픽별로(graphedges.js). ent 등록은 여기서.
    const forAgg = [];
    for (const t of realTopics) {
      const pubs = (t.pubs || []).map(nodeName).filter(keepNode), subs = (t.subs || []).map(nodeName).filter(keepNode);
      pubs.forEach((p) => ent(p, 'node'));
      subs.forEach((s) => ent(s, 'node'));
      forAgg.push({ name: t.name, pubNodes: pubs, subNodes: subs });
    }
    for (const e of aggregateTopicEdges(forAgg)) edges.push(e);
  }
  if (GF.services) for (const i of state.items) if (i.kind === 'service' && (i.server || []).length) {
    ent(i.name, 'service');
    (i.server || []).forEach((sv) => { if (!keepNode(sv)) return; ent(sv, 'node'); edges.push({ from: sv, to: i.name, kind: 'service' }); });
  }
  if (GF.actions) for (const [a, g] of actionGroups()) {
    ent(a, 'action');
    g.servers.forEach((sv) => { if (!keepNode(sv)) return; ent(sv, 'node'); edges.push({ from: sv, to: a, kind: 'action' }); });
    g.clients.forEach((c) => { if (!keepNode(c)) return; ent(c, 'node'); edges.push({ from: a, to: c, kind: 'action' }); });
  }
  return { ents, edges };
}

export function render() {
  const g = buildGraph();
  const t = state.items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')).length, n = state.items.filter((i) => i.kind === 'node').length, s = state.items.filter((i) => i.kind === 'service').length;
  $('#counts').textContent = `노드 ${n} · 토픽 ${t} · 서비스 ${s}`;
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600;
  for (const id of g.ents.keys()) if (!pos.has(id)) pos.set(id, { x: W / 2 + (Math.random() - .5) * 260, y: H / 2 + (Math.random() - .5) * 260, vx: 0, vy: 0 });
  for (const id of [...pos.keys()]) if (!g.ents.has(id)) pos.delete(id);
  G = g;
  renderSidebar();
  if (state.selItem && $('#valinfo')) renderInfo(byName(state.selItem.name) || state.selItem);   // 선택 정보 라이브 갱신(Hz·발행/구독자)
  const am = getActiveModal();
  if (am) am.refresh && am.refresh();
}

export async function refreshGraphNow() {
  try {
    const o = await api('/api/graph');
    if (!o || !o.items) return false;
    state.items = o.items;
    if (state.selItem && !byName(state.selItem.name)) {
      state.sel = null;
      state.selItem = null;
      const vt = $('#valtitle'), vi = $('#valinfo'), vv = $('#val');
      if (vt) vt.textContent = '선택 없음';
      if (vi) vi.textContent = '';
      if (vv) vv.textContent = '';
    }
    render();
    return true;
  } catch (_) { return false; }
}

function neighbors(id) {
  const s = new Set();
  for (const e of G.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }
  return s;
}

// 유효 하이라이트 결정: 호버 > 선택된 토픽(state.selItem.kind==='topic') > 기본(state.sel + neighbors, 기존 동작)
function effectiveHi() {
  if (hoverTarget) return hoverTarget;
  if (state.selItem && state.selItem.kind === 'topic') return { kind: 'topic', name: state.selItem.name };
  return null;
}

// 토픽 T 의 발행/구독 노드 집합 — T.pubs/T.subs 를 nodeName 으로 정규화
function topicHiSets(name) {
  const t = byName(name);
  if (!t) return null;
  return { name, pubs: new Set((t.pubs || []).map(nodeName)), subs: new Set((t.subs || []).map(nodeName)) };
}

const HALF_H = 11, GAP = 18;

function entW(name) {
  const e = G.ents.get(name);
  const base = name.replace(/^\//, '').length * 7 + 18;
  if (e && e.type === 'action') return Math.max(78, base + 24);
  if (e && e.type === 'service') return Math.max(72, base + 18);
  if (e && e.type === 'topic') return Math.max(56, base);
  return Math.max(64, base);
}

const halfW = (name) => entW(name) / 2;

function borderPt(p, hw, hh, dx, dy) {
  const s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh, 1e-6);
  return { x: p.x + dx * s, y: p.y + dy * s };
}

export function tick() {
  const W = $('#graph').clientWidth || 800, H = $('#graph').clientHeight || 600, ids = [...pos.keys()];
  const spread = gspread;
  // 척력(Coulomb) — 넉넉하게 밀어 노드가 서로 안 겹치게. 간격 배수의 제곱으로 평형 거리 ∝ spread.
  for (const a of ids) {
    const pa = pos.get(a);
    for (const b of ids) { if (a === b) continue; const pb = pos.get(b); const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy || 1, f = 95000 * spread * spread / d2, d = Math.sqrt(d2); pa.vx += dx / d * f * 0.02; pa.vy += dy / d * f * 0.02; }
    pa.vx += (W / 2 - pa.x) * 0.0012;
    pa.vy += (H / 2 - pa.y) * 0.0018;
  }
  // 인력(스프링) — 연결 노드는 적당한 거리로, 토픽 수(가중치)가 많을수록 살짝 더 가깝게. 이상 길이 ∝ spread.
  for (const e of G.edges) {
    const pa = pos.get(e.from), pb = pos.get(e.to);
    if (!pa || !pb) continue;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, wt = (e.labels ? e.labels.length : 1), ideal = (185 - Math.min(60, wt * 8)) * spread, f = (d - ideal) * 0.009;
    pa.vx += dx / d * f;
    pa.vy += dy / d * f;
    pb.vx -= dx / d * f;
    pb.vy -= dy / d * f;
  }
  for (const id of ids) { const p = pos.get(id); if (dragging === id) continue; p.x += p.vx *= 0.82; p.y += p.vy *= 0.82; }
  // 충돌 해소(위치 직접 분리) — 겹치는 사각형을 침투 적은 축으로 밀어냄. 라벨 겹침도 크게 줄어듦.
  const gap = GAP * spread;
  for (let it = 0; it < 2; it++) for (const a of ids) {
    if (dragging === a) continue;
    const pa = pos.get(a);
    for (const b of ids) {
      if (a === b) continue;
      const pb = pos.get(b);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const minX = halfW(a) + halfW(b) + gap, minY = 2 * HALF_H + gap, ox = minX - Math.abs(dx), oy = minY - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; pa.x -= s; if (dragging !== b) pb.x += s; }
        else { const s = (dy >= 0 ? 1 : -1) * oy / 2; pa.y -= s; if (dragging !== b) pb.y += s; }
      }
    }
  }
  for (const id of ids) { const p = pos.get(id); p.x = Math.max(halfW(id) + 4, Math.min(W - halfW(id) - 4, p.x)); p.y = Math.max(HALF_H + 4, Math.min(H - HALF_H - 4, p.y)); }
  paint();
  if (!(SNAP && ++tick.n > 480)) requestAnimationFrame(tick);
}
tick.n = 0;

const NS = 'http://www.w3.org/2000/svg';
const mkSVG = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const EC = { pub: '#6fd08c', sub: '#57c7d4', service: '#6f9be0', action: '#c78ad2', topic: '#3a4658' };

export function paint() {
  const eg = $('#edges'), ng = $('#nodes');
  const hiT = effectiveHi();
  let topicHi = null, hiId = state.sel;
  if (hiT && hiT.kind === 'topic') topicHi = topicHiSets(hiT.name);
  else if (hiT && hiT.kind === 'node') hiId = hiT.name;
  const nb = (!topicHi && hiId) ? neighbors(hiId) : null;
  eg.innerHTML = '';
  ng.innerHTML = '';
  for (const e of G.edges) {
    const pa = pos.get(e.from), pb = pos.get(e.to);
    if (!pa || !pb) continue;
    const rel = topicHi ? (GMODE === 'bipartite' ? (e.from === topicHi.name || e.to === topicHi.name) : (e.kind === 'topic' && e.labels.includes(topicHi.name))) : false;
    const hi = !topicHi && hiId && (e.from === hiId || e.to === hiId);
    const hv = hoverEdge === edgeKey(e);
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const s = borderPt(pa, halfW(e.from) + 3, HALF_H + 3, dx, dy), t = borderPt(pb, halfW(e.to) + 8, HALF_H + 8, -dx, -dy);
    const ln = mkSVG('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, class: 'edge' + (hi ? ' hi' : '') + (rel ? ' rel' : '') + (hv ? ' hv' : '') });
    if (hi || rel) { ln.style.strokeWidth = hv ? 3.2 : 2.4; } else { if (!hv) ln.style.stroke = EC[e.kind] || '#3a4658'; ln.style.strokeWidth = (e.kind === 'topic' ? Math.min(5, 1.1 + e.labels.length * 0.7) : 1.5) + (hv ? 1.3 : 0); if (e.kind === 'service') ln.style.strokeDasharray = '4 3'; }
    const ti = mkSVG('title', {});
    ti.textContent = e.labels ? e.labels.join('\n') : e.kind;
    ln.appendChild(ti);
    eg.appendChild(ln);
    if (e.kind === 'topic') {
      const d = Math.hypot(dx, dy) || 1, mx = (s.x + t.x) / 2 - dy / d * 7, my = (s.y + t.y) / 2 + dx / d * 7;
      const tx = mkSVG('text', { x: mx, y: my + 3, 'text-anchor': 'middle', class: 'elabel' + (hi ? ' hi' : '') + (rel ? ' rel' : '') + (hv ? ' hv' : '') });
      tx.textContent = e.labels.length;
      const t2 = mkSVG('title', {});
      t2.textContent = e.labels.join('\n');
      tx.appendChild(t2);
      eg.appendChild(tx);
    }
  }
  for (const id of pos.keys()) {
    const p = pos.get(id);
    const e = G.ents.get(id) || { type: 'node' };
    let isHi = false, relCls = '', dim = false;
    if (topicHi) {
      const isTopicEnt = GMODE === 'bipartite' && id === topicHi.name;
      if (isTopicEnt) isHi = true;
      else if (topicHi.pubs.has(id)) relCls = ' rel-pub';
      else if (topicHi.subs.has(id)) relCls = ' rel-sub';
      dim = !isTopicEnt && !relCls;
    } else {
      isHi = hiId && id === hiId;
      dim = hiId && id !== hiId && nb && !nb.has(id);
    }
    const g = mkSVG('g', { class: 'gnode ' + e.type + (isHi ? ' hi' : '') + relCls + (dim ? ' dim' : ''), transform: `translate(${p.x},${p.y})` });
    const label = id.replace(/^\//, ''); const w = entW(id), hw = w / 2;
    if (e.type === 'topic') g.appendChild(mkSVG('ellipse', { cx: 0, cy: 0, rx: hw, ry: 12 }));
    else if (e.type === 'service') g.appendChild(mkSVG('polygon', { points: `0,-13 ${hw},0 0,13 ${-hw},0` }));
    else if (e.type === 'action') g.appendChild(mkSVG('polygon', { points: `${-hw + 11},-12 ${hw - 11},-12 ${hw},0 ${hw - 11},12 ${-hw + 11},12 ${-hw},0` }));
    else g.appendChild(mkSVG('rect', { x: -hw, y: -11, width: w, height: 22 }));
    g.appendChild(Object.assign(mkSVG('text', { 'text-anchor': 'middle', y: 4 }), { textContent: label }));
    g.onmousedown = (ev) => {
      ev.stopPropagation();
      dragging = id;
      selectNode(id);
      if (e.type === 'topic') selectTopic(id);
      const mv = (m) => { const pp = pos.get(id); const gp = toGraph(m.clientX, m.clientY); pp.x = gp.x; pp.y = gp.y; };
      const up = () => { dragging = null; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      ev.preventDefault();
    };
    ng.appendChild(g);
  }
  applyGView();
}

function selectNode(id) {
  state.sel = id;
  const e = G.ents.get(id);
  state.selItem = byName(id) || { kind: e ? e.type : 'node', name: id };
  renderSidebar();
  renderValActs();
  renderInfo(state.selItem);
  if (state.selItem.kind !== 'topic') clearNonTopicSelection(state.selItem);
}

// 엣지 호버/클릭 — paint()가 60fps로 DOM을 통째로 새로 그려서 엣지 DOM에 리스너를 못 붙인다.
// #graph에 리스너 하나만 붙이고 매 mousemove마다 좌표→모든 엣지까지 최근접 거리로 히트테스트한다(엣지가 수십 개라 매 프레임 스캔해도 무리 없음).
const edgeKey = (e) => e.from + '\0' + e.to + '\0' + e.kind;

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

(function initEdgeHover() {
  const svg = $('#graph');
  if (!svg) return;
  let down = null;
  svg.addEventListener('mousemove', (ev) => {
    if (dragging) return;
    const gp = toGraph(ev.clientX, ev.clientY), th = 8 / gview.s;
    let best = null, bestD = th;
    for (const e of G.edges) {
      const pa = pos.get(e.from), pb = pos.get(e.to);
      if (!pa || !pb) continue;
      const d = distToSeg(gp.x, gp.y, pa.x, pa.y, pb.x, pb.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    hoverEdge = best ? edgeKey(best) : null;
    svg.classList.toggle('edge-hover', !!best);
  });
  svg.addEventListener('mousedown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  svg.addEventListener('mouseup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = null;
    if (moved < 4 && hoverEdge) {
      const e = G.edges.find((x) => edgeKey(x) === hoverEdge);
      if (e) openEdgeModal(e);
    }
  });
})();

// 그래프 컨트롤 바(rqt_graph 스타일 옵션) — 뷰 모드 토글 + 표시 필터.
(function injectGraphControls() {
  const main = document.querySelector('main');
  if (!main) return;
  const bar = el('div', { id: 'gctrl' });
  const seg = el('span', { class: 'seg' });
  const bN = el('button', { class: 'on' }, '노드'), bB = el('button', {}, '노드+토픽');
  const setMode = (m) => { GMODE = m; bN.className = m === 'nodes' ? 'on' : ''; bB.className = m === 'bipartite' ? 'on' : ''; pos.clear(); render(); };
  bN.onclick = () => setMode('nodes');
  bB.onclick = () => setMode('bipartite');
  seg.append(bN, bB);
  const chk = (key, label, init) => { const c = el('input', { type: 'checkbox' }); c.checked = init; c.onchange = () => { GF[key] = c.checked; render(); }; return el('label', {}, c, label); };
  bar.append(seg, chk('services', '서비스', true), chk('actions', '액션', true), chk('tf', 'tf', true), chk('debug', 'debug', false), chk('leaves', 'dead-end', true), chk('anon', 'CLI/도구 노드', false));
  // 노드 간격 슬라이더 — 실시간(척력/스프링/충돌 간격 배수). tick 루프가 매 프레임 gspread 를 읽어 즉시 반영.
  const sp = el('input', { type: 'range', min: '0.5', max: '3', step: '0.05', value: '1', title: '노드 간격', style: 'vertical-align:middle;width:110px' });
  const spVal = el('span', { class: 'hint', style: 'margin-left:4px;font-family:monospace' }, '1.0×');
  sp.oninput = () => { gspread = +sp.value; spVal.textContent = gspread.toFixed(2) + '×'; };
  bar.append(el('label', { style: 'display:inline-flex;align-items:center;gap:4px' }, el('span', {}, '간격'), sp, spVal));
  main.appendChild(bar);
})();
