/* RDash 웹 프론트엔드 — 부트스트랩. 스트림 연결, 툴바/키보드/그래프 팬줌 바인딩, Views 조립. */

import './lib/theme.js';
import './workspace.js';
import { $, el, api } from './lib/dom.js';
import { openStream } from './lib/stream.js';
import { state } from './lib/state.js';
import { ensureClock } from './lib/clock.js';
import { closeModal } from './lib/modal.js';
import { render, tick, paint, gview, applyGView } from './views/graph.js';
import { Views } from './views/index.js';
import { renderValActs } from './panels/value.js';

$('#wsbtn').onclick = () => { if (window.RDWorkspace) window.RDWorkspace.open(); };

api('/api/ver').then((o) => { state.ver = o.ver; $('#verlbl').textContent = 'ROS' + state.ver + ' · localhost'; });

// ── 텔레메트리 (WS 멀티플렉스) ───────────────────────────────────────────────
openStream('/events', (d) => { try { const o = JSON.parse(d); if (o.items) { state.items = o.items; render(); ensureClock(); } } catch (_) { /* */ } });

// ── 툴바 + 키보드 ─────────────────────────────────────────────────────────────
const TOOLS = [['E', '📈 PlotLab', () => Views.plotlab()], ['H', '🩺 Doctor', () => Views.doctor()], ['K', '📌 Baseline', () => Views.baseline()], ['A', '🔴 Trigger', () => Views.trigger()], ['g', '🎮 Teleop', () => Views.teleop()], ['b', '북마크', () => Views.bookmarks()], ['J', 'Jobs', () => Views.jobs()], ['L', '로그', () => Views.log()], ['v', '진단', () => Views.diag()], ['O', '개요', () => Views.overview()], ['P', '📊 프로세스', () => Views.procmon()], ['M', '🗺 Map', () => Views.map()], ['I', '🖼 Cam', () => Views.image()], ['C', '🧊 3D', () => Views.cloud()], ['t', 'TF', () => Views.tftree()]];
const tb = $('#toolbar');
TOOLS.forEach(([k, label, fn]) => tb.append(el('button', { title: k, onclick: fn }, label)));

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'Escape') { closeModal(); return; }
  const t = TOOLS.find((x) => x[0] === e.key);
  if (t) { t[2](); return; }
  if (!state.selItem) return;
  if (e.key === 'm' && state.selItem.kind === 'topic') Views.msgdef(state.selItem);
  else if (e.key === 'Q' && state.selItem.kind === 'topic') Views.qos(state.selItem);
  else if (e.key === 'c') Views.connections(state.selItem);
  else if (e.key === 'o' && state.selItem.kind === 'node') Views.params(state.selItem);
  else if (e.key === 'x') renderValActs();
});

window.addEventListener('resize', paint);

// 그래프 줌(휠, 커서 기준)/팬(빈 곳 드래그) — 노드 드래그는 stopPropagation 으로 분리.
(function graphNav() {
  const svg = $('#graph');
  if (!svg) return;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rc = svg.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top, f = e.deltaY < 0 ? 1.12 : 1 / 1.12, ns = Math.max(0.3, Math.min(4, gview.s * f)), k = ns / gview.s;
    gview.ox = mx - (mx - gview.ox) * k;
    gview.oy = my - (my - gview.oy) * k;
    gview.s = ns;
    applyGView();
  }, { passive: false });
  let pan = null;
  svg.addEventListener('mousedown', (e) => { pan = { x: e.clientX, y: e.clientY }; svg.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { if (pan) { pan = null; svg.style.cursor = ''; } });
  svg.addEventListener('mousemove', (e) => { if (!pan) return; gview.ox += e.clientX - pan.x; gview.oy += e.clientY - pan.y; pan = { x: e.clientX, y: e.clientY }; applyGView(); });
})();

requestAnimationFrame(tick);

window.RD = { closeModal, Views };
