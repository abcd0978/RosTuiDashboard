/* 값 / 플롯 — 우측 패널의 echo·숫자 필드 플롯·게이지. echoES/series/order/picked/t0 와
   게이지 레인지(gMin/gMax/gKey)는 이 모듈에 캡슐화된 상태다. */

import { $, el, post } from '../lib/dom.js';
import { openStream } from '../lib/stream.js';
import { state, byName } from '../lib/state.js';
import { toast } from '../lib/modal.js';
import { kindIcon, renderInfo } from './info.js';
import { renderSidebar } from './sidebar.js';
import { Views } from '../views/index.js';

let echoES = null, series = {}, order = [], picked = new Set(), t0 = Date.now();
let gMin = Infinity, gMax = -Infinity, gKey = null;   // 게이지 자동 레인지(필드별)

// 오른쪽 패널에 게이지 섹션 삽입(Foxglove Gauge 패널 대응) — 첫 선택 숫자 필드의 현재값을 반원 다이얼로.
(function injectGauge() {
  const r = $('#right');
  if (!r) return;
  r.append(el('div', { class: 'sec' }, '게이지 (첫 선택 필드)'), el('div', { class: 'box' }, el('canvas', { id: 'gauge', width: 300, height: 120 })));
})();

// echo 스트림 종료 — 선택 변경 시 진행 중이던 구독을 닫는다.
export function stopEcho() {
  if (echoES) { echoES.close(); echoES = null; }
}

// 노드/서비스/파라미터/액션 선택 시(비-토픽) — 제목만 갱신, echo 종료, 값 텍스트 비움.
export function clearNonTopicSelection(it) {
  $('#valtitle').textContent = `${kindIcon(it.kind)} ${it.name}`;
  stopEcho();
  $('#val').textContent = '';
}

// 사이드바에서 비-토픽 항목을 고를 때(onPick) — echo·시리즈·필드 UI 전부 리셋.
export function resetSeriesForPick(it) {
  stopEcho();
  series = {};
  order = [];
  picked = new Set();
  $('#fields').innerHTML = '';
  $('#val').textContent = '';
  $('#valtitle').textContent = `${kindIcon(it.kind)} ${it.name}`;
}

function drawGauge() {
  const cv = $('#gauge');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const k = [...picked][0];
  if (!k || !series[k] || !series[k].length) {
    ctx.fillStyle = '#8b97a7';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('숫자 필드 선택 시 게이지', W / 2, H / 2);
    return;
  }
  if (k !== gKey) { gKey = k; gMin = Infinity; gMax = -Infinity; }   // 게이지 필드가 바뀌면 레인지 리셋
  const v = series[k][series[k].length - 1][1];
  gMin = Math.min(gMin, v);
  gMax = Math.max(gMax, v);
  let lo = gMin, hi = gMax;
  if (hi - lo < 1e-6) { hi = lo + 1; lo -= 1; }
  const frac = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const cx = W / 2, cy = H - 22, r = Math.min(W / 2 - 14, H - 34);
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#232b36';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = frac > 0.85 ? '#e06a6a' : frac > 0.6 ? '#e2c85a' : '#57c7d4';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + frac * Math.PI);
  ctx.stroke();
  ctx.fillStyle = '#d5dae2';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(v.toFixed(3), cx, cy - 6);
  ctx.fillStyle = '#8b97a7';
  ctx.font = '10px monospace';
  ctx.fillText(k, cx, cy + 12);
  ctx.textAlign = 'left';
  ctx.fillText(lo.toFixed(1), cx - r - 2, cy + 14);
  ctx.textAlign = 'right';
  ctx.fillText(hi.toFixed(1), cx + r + 2, cy + 14);
}

export function numeric(text) {
  const out = {};
  const stack = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim() === '---') continue;
    const ind = raw.length - raw.trimStart().length;
    const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim();
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const path = [...stack.map((s) => s.key), key].join('.');
    if (val === '') { stack.push({ ind, key }); continue; }
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) out[path] = parseFloat(val);
  }
  return out;
}

// 모든 스칼라 리프(문자/불리언/enum 포함) — State Transitions 용. {path, val(문자열)} 목록.
export function leaves(text) {
  const out = [];
  const stack = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim() === '---') continue;
    const ind = raw.length - raw.trimStart().length;
    const m = raw.trimStart().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim();
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const path = [...stack.map((s) => s.key), key].join('.');
    if (val === '') { stack.push({ ind, key }); continue; }
    out.push({ path, val: val.replace(/^['"]|['"]$/g, '') });
  }
  return out;
}

export function selectTopic(name) {
  $('#valtitle').textContent = `${kindIcon('topic')} ${name}`;
  state.sel = name;
  renderSidebar();
  renderValActs();
  renderInfo(byName(name) || { kind: 'topic', name });
  stopEcho();
  series = {};
  order = [];
  picked = new Set();
  t0 = Date.now();
  gMin = Infinity;
  gMax = -Infinity;
  gKey = null;
  $('#fields').innerHTML = '';
  echoES = openStream('/echo?topic=' + encodeURIComponent(name), (d) => {
    const text = JSON.parse(d);
    $('#val').textContent = text.slice(0, 1500);
    const nums = numeric(text), t = (Date.now() - t0) / 1000;
    for (const [k, v] of Object.entries(nums)) {
      if (!series[k]) { series[k] = []; order.push(k); if (picked.size < 2) picked.add(k); renderFields(); }
      series[k].push([t, v]);
      if (series[k].length > 600) series[k].shift();
    }
    drawPlot();
    drawGauge();
  });
}

export function renderValActs() {
  const box = $('#valacts');
  box.innerHTML = '';
  const it = state.selItem;
  if (!it) return;
  const add = (label, fn) => box.append(el('button', { class: 'act', onclick: fn }, label));
  if (it.kind === 'topic') {
    add('publish', () => Views.publish(it));
    add('states', () => Views.states(it));
    if ((it.ty || '').includes('NavSatFix')) add('🗺 map', () => Views.map(it));
    if ((it.ty || '').includes('CompressedImage') || (it.ty || '').includes('sensor_msgs/msg/Image')) add('🖼 image', () => Views.image(it));
    if ((it.ty || '').includes('PointCloud2') || /visualization_msgs\/(msg\/)?Marker(Array)?/.test(it.ty || '')) add('🧊 3D', () => Views.cloud(it));
    add('msg def', () => Views.msgdef(it));
    add('QoS', () => Views.qos(it));
    add('connections', () => Views.connections(it));
    add(state.marked.has(it.name) ? 'unmark' : 'mark', () => { state.marked.has(it.name) ? state.marked.delete(it.name) : state.marked.add(it.name); renderSidebar(); renderValActs(); });
  }
  if (it.kind === 'service') add('call', () => Views.service(it));
  if (it.kind === 'param') add('set', () => Views.setparam(it));
  if (it.kind === 'node') {
    add('params', () => Views.params(it));
    add('kill', () => post('/api/killnode', { name: it.name }).then((r) => toast(r.out)));
    add('restart', () => post('/api/restart', { name: it.name }).then((r) => toast(r.out)));
    add('lifecycle', () => Views.lifecycle(it));
    add('connections', () => Views.connections(it));
  }
  if (it.kind === 'action') add('send goal', () => Views.action(it));
}

export function renderFields() {
  const f = $('#fields');
  f.innerHTML = '';
  order.forEach((k) => {
    const c = el('input', { type: 'checkbox', 'data-k': k });
    c.checked = picked.has(k);
    c.onchange = () => { c.checked ? picked.add(k) : picked.delete(k); drawPlot(); };
    f.append(el('label', {}, c, k));
  });
}

export function drawPlot() {
  const cv = $('#plot'), ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth, Hh = cv.height;
  ctx.clearRect(0, 0, W, Hh);
  const keys = [...picked].filter((k) => series[k] && series[k].length > 1);
  if (!keys.length) return;
  let mn = Infinity, mx = -Infinity, tmin = Infinity, tmax = -Infinity;
  for (const k of keys) for (const [t, v] of series[k]) { if (v < mn) mn = v; if (v > mx) mx = v; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
  const cols = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2'];
  keys.forEach((k, ci) => {
    ctx.strokeStyle = cols[ci % cols.length];
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    series[k].forEach(([t, v], i) => { const x = (t - tmin) / (tmax - tmin || 1) * (W - 8) + 4, y = Hh - 6 - (v - mn) / (mx - mn) * (Hh - 14); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = cols[ci % cols.length];
    ctx.fillText(k, 6, 12 + ci * 12);
  });
}
