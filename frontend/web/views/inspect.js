/* msgdef · qos · connections · tftree · params · setparam · lifecycle · states — 항목 검사/조작 뷰. */

import { el, api, post, spinner, emptyState } from '../lib/dom.js';
import { byName } from '../lib/state.js';
import { openModal, setModalSub } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';
import { leaves } from '../panels/value.js';

export async function msgdef(it) {
  const pre = el('pre', { class: 'out' }, spinner('메시지 정의 조회 중…'));
  openModal('📄 ' + (it.ty || it.name), pre);
  const r = await api('/api/msgdef?type=' + encodeURIComponent(it.ty || ''));
  pre.textContent = r.out || '';
  if (!r.out) { pre.textContent = ''; pre.append(emptyState('📭', '메시지 정의 없음', (it.ty || '') + ' 타입 정보를 가져올 수 없습니다')); }
}

export function qos(it) {
  const t = byName(it.name) || it;
  const pubs = t.pubs || [], subs = t.subs || [];
  const REL = (r) => (r === 'R' ? 'RELIABLE' : r === 'B' ? 'BEST_EFFORT' : '?'), DUR = (d) => (d === 'T' ? 'TRANSIENT_LOCAL' : d === 'V' ? 'VOLATILE' : '?');
  const mismatch = pubs.some((p) => p[1] === 'B') && subs.some((s) => s[1] === 'R');
  const tbl = el('table', { class: 'tbl' });
  tbl.append(el('tr', {}, el('th', {}, '역할'), el('th', {}, '노드'), el('th', {}, 'reliability'), el('th', {}, 'durability')));
  pubs.forEach((p) => tbl.append(el('tr', {}, el('td', {}, 'pub'), el('td', {}, p[0]), el('td', {}, REL(p[1])), el('td', {}, DUR(p[2])))));
  subs.forEach((p) => tbl.append(el('tr', {}, el('td', {}, 'sub'), el('td', {}, p[0]), el('td', {}, REL(p[1])), el('td', {}, DUR(p[2])))));
  const warn = el('p', { style: 'color:' + (mismatch ? 'var(--red)' : 'var(--green)') }, mismatch ? '⚠ reliability 불일치 — RELIABLE 구독자는 BEST_EFFORT 발행자 메시지를 못 받습니다' : '✓ reliability 호환');
  openModal('🔌 QoS — ' + it.name, el('div', {}, tbl, warn));
}

export async function connections(it) {
  const pre = el('pre', { class: 'out' }, spinner('연결 관계 조회 중…'));
  openModal('🔗 ' + it.name, pre);
  const r = await api(`/api/connections?kind=${it.kind}&name=${encodeURIComponent(it.name)}`);
  pre.textContent = r.out || '';
  if (!r.out) { pre.append(emptyState('🔗', '연결 정보 없음')); }
}

export async function tftree() {
  const pre = el('pre', { class: 'out' }, spinner('/tf 수집 중…'));
  openModal('🌳 TF tree', pre);
  const r = await api('/api/tftree');
  pre.textContent = r.out || '';
  if (!(r.out || '').trim()) { pre.append(emptyState('🌳', 'TF 프레임 없음', '/tf 토픽에서 변환을 받지 못했습니다')); }
}

export function setparam(it) {
  const inp = el('input', { style: 'width:100%', value: '' });
  const out = el('pre', { class: 'out' });
  openModal('set param — ' + it.name, el('div', {}, inp, el('div', { class: 'actbtns' }, el('button', { class: 'act', onclick: async () => { const r = await post('/api/setparam1', { name: it.name, value: inp.value }); out.textContent = r.out; } }, '적용')), out));
}

export async function params(it) {
  const wrap = el('div', {}, spinner('파라미터 조회 중…'));
  openModal('⚙ params — ' + it.name, wrap);
  const r = await api('/api/param/list?node=' + encodeURIComponent(it.name));
  wrap.innerHTML = '';
  if (!r.rows || !r.rows.length) { wrap.append(emptyState('⚙', '파라미터 없음', it.name + ' 노드에 선언된 파라미터가 없습니다')); return; }
  const tbl = el('table', { class: 'tbl' });
  tbl.append(el('tr', {}, el('th', {}, 'parameter'), el('th', {}, 'value'), el('th', {}, '')));
  for (const row of r.rows) {
    const val = el('input', { value: row.value, style: 'width:120px' });
    const cell = el('td', {}, val);
    const setb = el('button', { class: 'act', onclick: async () => { const rr = await post('/api/param/set', { node: it.name, name: row.name, value: val.value }); val.value = rr.value; } }, 'set');
    tbl.append(el('tr', {}, el('td', {}, row.name), cell, el('td', {}, setb)));
  }
  wrap.append(tbl);
}

export function lifecycle(it) {
  const box = el('div', { class: 'actbtns' });
  const out = el('pre', { class: 'out' });
  ['configure', 'activate', 'deactivate', 'cleanup', 'shutdown'].forEach((tr) => box.append(el('button', { class: 'act', onclick: async () => { const r = await post('/api/lifecycle', { node: it.name, transition: tr }); out.textContent = r.out; } }, tr)));
  openModal('♻ lifecycle — ' + it.name, el('div', {}, box, out));
}

export function states(it) {
  const sel = el('select', {});
  const cv = el('canvas', { id: 'stcv', width: 900, height: 46, style: 'width:100%;height:52px;background:#0d1116;border:1px solid var(--line);border-radius:4px;margin:6px 0' });
  const leg = el('div', { class: 'fields' }), cur = el('div', { class: 'hint' });
  openModal('⤳ State Transitions — ' + it.name, el('div', {}, el('div', { class: 'hint' }, '필드 선택 → 값 전이를 시간축 색 밴드로 (enum·bool·문자열에 유용)'), sel, cv, cur, leg));
  const seg = [];
  let live = null, tt0 = Date.now();
  const colors = {}, PAL = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2', '#e06a6a', '#6f9be0', '#d98a4b'];
  let fields = [], field = null;
  const draw = () => {
    const ctx = cv.getContext('2d'), W = cv.width = cv.clientWidth || 900, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!seg.length) return;
    const tmin = seg[0].t0, tmax = (live ? live.t1 : seg[seg.length - 1].t1) || tmin + 1, span = tmax - tmin || 1;
    for (const s of seg) { const x = (s.t0 - tmin) / span * W, w = Math.max(1.5, (s.t1 - s.t0) / span * W); ctx.fillStyle = colors[s.v] || '#888'; ctx.fillRect(x, 8, w, 30); }
    leg.innerHTML = '';
    Object.entries(colors).forEach(([v, c]) => leg.append(el('label', {}, el('span', { style: `display:inline-block;width:11px;height:11px;border-radius:2px;background:${c}` }), ' ' + v)));
  };
  setModalSub(openStream('/echo?topic=' + encodeURIComponent(it.name), (d) => {
    const lv = leaves(JSON.parse(d));
    if (!fields.length && lv.length) {
      fields = lv.map((x) => x.path);
      sel.innerHTML = '';
      fields.forEach((f) => sel.append(el('option', { value: f }, f)));
      field = fields[0];
      sel.onchange = () => { field = sel.value; seg.length = 0; live = null; for (const k in colors) delete colors[k]; draw(); };
    }
    const f = lv.find((x) => x.path === field);
    if (!f) return;
    const v = f.val, t = (Date.now() - tt0) / 1000;
    cur.textContent = `현재: ${field} = ${v}`;
    if (live && live.v === v) { live.t1 = t; } else { live = { v, t0: t, t1: t }; seg.push(live); if (!(v in colors)) colors[v] = PAL[Object.keys(colors).length % PAL.length]; if (seg.length > 400) seg.shift(); }
    draw();
  }));
}
