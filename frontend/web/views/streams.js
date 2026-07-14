/* streamView(구 stream) · log · diag — 실시간 라인 스트림(로그/진단) 모달. */

import { el } from '../lib/dom.js';
import { openModal, setModalSub } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';

export function streamView(title, endpoint, parse, klass) {
  const filterInp = el('input', { placeholder: '필터…', style: 'margin-bottom:6px' });
  const tbl = el('table', { class: 'tbl' }), wrap = el('div', {}, filterInp, tbl);
  openModal(title, wrap);
  const rows = [];
  const rerender = () => { const f = filterInp.value.toLowerCase(); tbl.innerHTML = ''; rows.filter((r) => !f || r.text.toLowerCase().includes(f)).slice(-400).forEach((r) => tbl.append(el('tr', { class: 'lrow ' + r.cls }, el('td', {}, r.a), el('td', {}, r.b)))); wrap.scrollTop = wrap.scrollHeight; };
  filterInp.oninput = rerender;
  setModalSub(openStream(endpoint, (d) => { const blk = JSON.parse(d); for (const r of parse(blk)) { rows.push(r); if (rows.length > 1000) rows.shift(); } rerender(); }));
}

export function log() {
  const L = (l) => (l >= 50 ? 'FATAL' : l >= 40 ? 'ERROR' : l >= 30 ? 'WARN' : l >= 20 ? 'INFO' : 'DEBUG'), C = (l) => (l >= 40 ? 'ERROR' : l >= 30 ? 'WARN' : 'OK');
  streamView('📜 로그 /rosout', '/rosout', (blk) => {
    const lv = /level:\s*(\d+)/.exec(blk), nm = /name:\s*["']?([^\n"']+)/.exec(blk), ms = /msg:\s*["']?(.*)/.exec(blk), lvl = lv ? +lv[1] : 0;
    return [{ a: L(lvl), b: (nm ? nm[1].trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), cls: C(lvl), text: blk }];
  });
}

export function diag() {
  const LV = ['OK', 'WARN', 'ERROR', 'STALE'];
  streamView('🩺 진단 /diagnostics', '/diagnostics', (blk) => {
    const out = [];
    const si = blk.indexOf('status:'), sb = si >= 0 ? blk.slice(si) : blk;
    for (const part of sb.split(/\n\s*- /).slice(1)) {
      const lv = /level:\s*(\d+)/.exec(part), nm = /name:\s*["']?(.*)/.exec(part), ms = /message:\s*["']?(.*)/.exec(part), lvl = lv ? +lv[1] : 0;
      out.push({ a: LV[lvl] || '?', b: (nm ? nm[1].replace(/["']\s*$/, '').trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), cls: LV[lvl] || 'OK', text: part });
    }
    return out;
  });
}
