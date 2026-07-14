/* bookmarks · jobs — 북마크 실행/편집, 백그라운드 작업 모니터. */

import { $, el, api, post } from '../lib/dom.js';
import { openModal, getActiveModal, toast } from '../lib/modal.js';
import { refreshGraphNow } from './graph.js';

export async function bookmarks() {
  const wrap = el('div', {});
  openModal('★ 북마크', wrap);
  const draw = async () => {
    const r = await api('/api/bookmarks'), list = r.bookmarks || [];
    const presets = r.presets || [], cur = r.preset || '';
    $('#mtitle').textContent = '★ 북마크' + (cur ? ' [' + cur + ']' : '');
    wrap.innerHTML = '';
    // 프리셋 스위처 — 클릭 또는 s 로 전환(TUI 와 동일)
    if (presets.length > 1) {
      const bar = el('div', { class: 'actbtns', style: 'margin-bottom:8px' }, el('span', { style: 'color:var(--dim)' }, '프리셋: '));
      presets.forEach((nm) => { const on = nm === cur; bar.append(el('button', { class: 'act', style: on ? 'font-weight:700;color:var(--cyan)' : '', onclick: async () => { await post('/api/preset', { name: nm }); draw(); } }, nm)); });
      bar.append(el('span', { style: 'color:var(--dim)' }, '  ·  s 로 전환'));
      wrap.append(bar);
    }
    const tbl = el('table', { class: 'tbl' });
    list.forEach((b, i) => {
      const run = el('button', { class: 'act', onclick: () => post('/api/job', { label: b.name, cmd: b.cmd }).then(() => toast('▶ ' + b.name)) }, '실행');
      const del = el('button', { class: 'act', onclick: async () => { const nn = list.filter((_, j) => j !== i); await post('/api/bookmarks', { bookmarks: nn }); draw(); } }, '삭제');
      tbl.append(el('tr', {}, el('td', {}, '[' + (b.key || '·') + ']'), el('td', {}, b.name), el('td', { style: 'color:var(--dim)' }, b.cmd), el('td', {}, run, ' ', del)));
    });
    wrap.append(tbl);
    const nm = el('input', { placeholder: '이름' }), cm = el('input', { placeholder: 'cmd', style: 'width:50%' });
    const addb = el('button', { class: 'act', onclick: async () => { const key = String((list.length + 1) % 10); await post('/api/bookmarks', { bookmarks: [...list, { name: nm.value || cm.value, cmd: cm.value, key }] }); draw(); } }, '추가');
    wrap.append(el('div', { class: 'actbtns', style: 'margin-top:8px' }, nm, cm, addb));
  };
  // s = 프리셋 순환(입력창 포커스 시 무시). 모달 닫힐 때 리스너 해제.
  const onKey = async (e) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; if (e.key === 's') { e.preventDefault(); await post('/api/preset', {}); draw(); } };
  window.addEventListener('keydown', onKey);
  getActiveModal().close = () => window.removeEventListener('keydown', onKey);
  draw();
}

export function jobs() {
  const wrap = el('div', {});
  openModal('⚙ Jobs', wrap, () => {});
  const draw = async () => {
    const r = await api('/api/jobs');
    wrap.innerHTML = '';
    const tbl = el('table', { class: 'tbl' });
    (r.jobs || []).forEach((j) => {
      const kill = el('button', { class: 'act', onclick: async () => { kill.disabled = true; kill.textContent = 'stopping'; await post(`/api/job/${j.id}/kill`, {}); await refreshGraphNow(); await draw(); setTimeout(draw, 700); setTimeout(refreshGraphNow, 900); } }, 'kill');
      tbl.append(el('tr', {}, el('td', {}, el('span', { class: 'badge ' + j.status }, j.status)), el('td', {}, '[' + (j.pid || '?') + '] ' + j.label), el('td', {}, kill)));
      tbl.append(el('tr', {}, el('td', { colspan: 3 }, el('pre', { class: 'out', style: 'color:var(--dim);max-height:80px' }, (j.log || []).join('\n')))));
    });
    wrap.append(tbl);
  };
  draw();
  const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 1500);
}
