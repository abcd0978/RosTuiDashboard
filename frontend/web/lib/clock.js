/* 시뮬레이션 시각(/clock) — 있으면 구독해 sim time 추적(rosgraph_msgs/Clock). wallclock 과 함께 표시. */

import { $ } from './dom.js';
import { openStream } from './stream.js';
import { state } from './state.js';

export const Clock = {
  sim: null,
  at: 0,
  es: null,
  stale() { return this.sim != null && Date.now() - this.at > 1500; },
};

export function ensureClock() {
  if (Clock.es || !state.items.some((i) => i.name === '/clock')) return;
  Clock.es = openStream('/echo?topic=/clock', (d) => {
    try {
      const t = JSON.parse(d);
      const s = /\bsec:\s*(\d+)/.exec(t), ns = /nanosec:\s*(\d+)/.exec(t);
      if (s) { Clock.sim = (+s[1]) + (ns ? (+ns[1]) / 1e9 : 0); Clock.at = Date.now(); }
    } catch (_) { /* */ }
  });
}

export function paintClock() {
  const c = $('#clock');
  if (!c) return;
  const wall = new Date().toLocaleTimeString();
  c.textContent = Clock.sim != null ? `🕒 ${wall} · sim ${Clock.sim.toFixed(1)}s${Clock.stale() ? ' ⏸' : ''}` : `🕒 ${wall}`;
}

setInterval(paintClock, 500);
paintClock();
