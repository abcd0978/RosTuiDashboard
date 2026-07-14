/* 🔴 트리거 녹화 — 조건 발생 시 자동 캡처. 무장은 모달을 닫아도 유지(전역 컨트롤러) */

import { $, el, post } from './dom.js';
import { openStream } from './stream.js';
import { state } from './state.js';
import { diagnose } from './diagnose.js';

export const Trigger = { armed: false, cond: 'graph', last: 0, es: null, iv: null, log: [], onchange: null };

export function trigBadge() {
  let b = $('#trigbadge');
  if (!b) { b = el('span', { id: 'trigbadge', class: 's', style: 'color:var(--red);font-weight:600' }); $('#counts').after(b); }
  b.textContent = Trigger.armed ? '  🔴 TRIG' : '';
  if (Trigger.onchange) Trigger.onchange();
}

export function trigFire(reason) {
  const now = Date.now();
  if (now - Trigger.last < 30000) return;
  Trigger.last = now;
  post('/api/record', {}).then((r) => {
    Trigger.log.unshift(`${new Date(now).toLocaleTimeString()} · ${reason} → rosbag job ${r.id || '?'}`);
    if (Trigger.log.length > 30) Trigger.log.pop();
    trigBadge();
  });
}

export function trigDisarm() {
  Trigger.armed = false;
  if (Trigger.es) { Trigger.es.close(); Trigger.es = null; }
  if (Trigger.iv) { clearInterval(Trigger.iv); Trigger.iv = null; }
  trigBadge();
}

export function trigArm(cond) {
  trigDisarm();
  Trigger.armed = true;
  Trigger.cond = cond;
  Trigger.last = 0;
  if (cond === 'diag') {
    Trigger.es = openStream('/diagnostics', (d) => { try { if (/level:\s*2/.test(JSON.parse(d))) trigFire('/diagnostics ERROR'); } catch (_) { /* */ } });
  } else {
    Trigger.iv = setInterval(() => { const errs = diagnose(state.items).issues.filter((i) => i.sev === 0); if (errs.length) trigFire('그래프 ERROR: ' + errs[0].target); }, 2000);
  }
  trigBadge();
}
