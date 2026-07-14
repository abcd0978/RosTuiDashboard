/* doctor · baseline · trigger · procmon · overview — 헬스/리소스/트리거 뷰. */

import { $, el, api, post } from '../lib/dom.js';
import { state, byName, topics } from '../lib/state.js';
import { openModal, closeModal, toast } from '../lib/modal.js';
import { SEV, diagnose } from '../lib/diagnose.js';
import { snapProfile, diffBaseline } from '../lib/baseline.js';
import { Trigger, trigArm, trigDisarm } from '../lib/trigger.js';
import { onPick } from '../panels/sidebar.js';
import { refreshGraphNow } from './graph.js';

export function doctor() {
  const wrap = el('div', {});
  openModal('🩺 Doctor — 시스템 건강', wrap, () => {});
  const draw = () => {
    const { issues, counts, scanned } = diagnose(state.items);
    wrap.innerHTML = '';
    const clr = ['var(--red)', 'var(--yellow)', 'var(--dim)'], mark = ['●', '▲', 'ℹ'];
    wrap.append(el('div', { class: 'hint', style: 'margin-bottom:8px' }, `노드 ${scanned.nodes} · 토픽 ${scanned.topics}  —  `,
      el('span', { style: 'color:var(--red)' }, counts.ERROR + ' ERROR'), ' · ',
      el('span', { style: 'color:var(--yellow)' }, counts.WARN + ' WARN'), ' · ',
      el('span', { style: 'color:var(--dim)' }, counts.INFO + ' INFO')));
    if (!issues.length) { wrap.append(el('p', { style: 'color:var(--green)' }, '✓ 문제 없음 — 그래프가 건강합니다')); return; }
    const tbl = el('table', { class: 'tbl' });
    issues.forEach((iss) => {
      const row = el('tr', { style: 'cursor:pointer' }, el('td', { style: 'color:' + clr[iss.sev] + ';white-space:nowrap' }, mark[iss.sev] + ' ' + SEV[iss.sev]), el('td', { style: 'color:var(--cyan)' }, iss.target), el('td', {}, iss.msg));
      row.onclick = () => { const it = byName(iss.target); if (it) { closeModal(); onPick(it); } };
      tbl.append(row);
    });
    wrap.append(tbl);
  };
  draw();
  const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
}

export async function baseline() {
  const wrap = el('div', {});
  openModal('📌 Baseline / 회귀', wrap, () => {});
  const clr = ['var(--red)', 'var(--yellow)', 'var(--dim)'], mark = ['●', '▲', 'ℹ'], SV = ['ERROR', 'WARN', 'INFO'];
  let base = null;
  const save = async () => { await post('/api/baseline', { profile: { ...snapProfile(state.items), at: Date.now() } }); base = (await api('/api/baseline')).baseline; draw(); toast('기준선 저장됨', 'ok'); };
  const draw = () => {
    wrap.innerHTML = '';
    const bar = el('div', { class: 'actbtns', style: 'margin-bottom:8px' }, el('button', { class: 'act', onclick: save }, base ? '기준선 재저장(현재)' : '현재를 기준선으로 저장'));
    wrap.append(bar);
    if (!base) { wrap.append(el('p', { style: 'color:var(--yellow)' }, '저장된 기준선이 없습니다. 정상 상태에서 위 버튼으로 기준선을 저장하세요.')); return; }
    const when = base.at ? new Date(base.at).toLocaleString() : '';
    wrap.append(el('div', { class: 'hint', style: 'margin-bottom:6px' }, `기준선: 노드 ${(base.nodes || []).length} · 토픽 ${Object.keys(base.topics || {}).length}${when ? ' · ' + when : ''}`));
    const rows = diffBaseline(base, state.items);
    if (!rows.length) { wrap.append(el('p', { style: 'color:var(--green)' }, '✓ 기준선과 동일 — 회귀 없음')); return; }
    const tbl = el('table', { class: 'tbl' });
    rows.forEach((r) => { const tr = el('tr', { style: 'cursor:pointer' }, el('td', { style: 'color:' + clr[r.sev] + ';white-space:nowrap' }, mark[r.sev] + ' ' + SV[r.sev]), el('td', { style: 'color:var(--cyan)' }, r.target), el('td', {}, r.msg)); tr.onclick = () => { const it = byName(r.target); if (it) { closeModal(); onPick(it); } }; tbl.append(tr); });
    wrap.append(tbl);
  };
  base = (await api('/api/baseline')).baseline;
  draw();
  const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
}

export function trigger() {
  const wrap = el('div', {});
  openModal('🔴 트리거 녹화 — 조건부 자동 캡처', wrap, () => {});
  const draw = () => {
    wrap.innerHTML = '';
    const sel = el('select', {}, el('option', { value: 'graph' }, '그래프 ERROR (QoS 불일치 등)'), el('option', { value: 'diag' }, '/diagnostics ERROR'));
    sel.value = Trigger.cond;
    const btn = el('button', { class: 'act', onclick: () => { if (Trigger.armed) trigDisarm(); else trigArm(sel.value); draw(); } }, Trigger.armed ? '■ 해제' : '● 무장');
    wrap.append(el('div', { class: 'hint', style: 'margin-bottom:8px' }, '조건 발생 시 자동으로 rosbag 캡처(쿨다운 30s). 무장은 모달을 닫아도 유지됩니다.'),
      el('div', { class: 'actbtns' }, el('span', {}, '조건'), sel, btn, el('span', { style: 'color:' + (Trigger.armed ? 'var(--red)' : 'var(--dim)') }, Trigger.armed ? '🔴 무장됨' : '○ 해제됨')));
    wrap.append(el('div', { class: 'sec', style: 'padding-left:0;margin-top:10px' }, '발동 기록'));
    if (!Trigger.log.length) { wrap.append(el('p', { class: 'hint' }, '아직 발동 없음')); return; }
    const tbl = el('table', { class: 'tbl' });
    Trigger.log.forEach((l) => tbl.append(el('tr', {}, el('td', {}, l))));
    wrap.append(tbl);
  };
  Trigger.onchange = draw;
  draw();
}

export function procmon() {
  const wrap = el('div', {});
  openModal('📊 노드 프로세스 (CPU/RSS/스레드 · 라이브)', wrap, () => {});
  const nodes = () => state.items.filter((i) => i.kind === 'node').map((i) => i.name);
  const cleanRos = async () => {
    if (!confirm('rosbridge/web/roscore를 제외한 ROS 노드와 Gazebo/PX4/Fast-LIO/Super/Turtlesim 프로세스를 정리합니다. 계속할까요?')) return;
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'hint' }, 'Clean ROS 실행 중…'));
    const r = await post('/api/clean-ros', {});
    await refreshGraphNow();
    await draw(r.out || '(출력 없음)');
  };
  const draw = async (note = '') => {
    const r = await post('/api/resource', { nodes: nodes() });
    const lines = (r.out || '').split('\n').filter((l) => l.trim() && !l.startsWith('('));
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'actbtns', style: 'margin-bottom:6px' },
      el('button', { class: 'act', style: 'color:var(--red);font-weight:700', onclick: cleanRos }, 'Clean ROS'),
      el('span', { class: 'hint' }, 'CPU% 내림차순 · 2초 갱신 · 노드별 kill/restart (독립 프로세스 노드만 값 표시)')));
    if (note) wrap.append(el('pre', { class: 'out', style: 'max-height:160px;margin-bottom:8px' }, note));
    const tbl = el('table', { class: 'tbl' });
    tbl.append(el('tr', {}, el('th', {}, 'CPU%'), el('th', {}, '노드'), el('th', {}, 'PID'), el('th', {}, 'RSS'), el('th', {}, 'THR'), el('th', {}, '')));
    const seen = new Set();
    lines.forEach((l) => {
      const m = l.match(/^\s*(\S+)\s+(\S+)\s+pid\s+(\S+)\s+(\S+)\s*MB\s+(\S+)\s*thr/);
      if (!m) return;
      const [, cpu, name, pid, rss, thr] = m;
      seen.add(name);
      const kill = el('button', { class: 'act', onclick: async () => { const rr = await post('/api/killnode', { name }); toast('kill ' + name + ': ' + rr.out); await refreshGraphNow(); await draw(); setTimeout(refreshGraphNow, 800); } }, 'kill');
      const rest = el('button', { class: 'act', onclick: () => post('/api/restart', { name }).then(() => toast('restart ' + name)) }, 'restart');
      tbl.append(el('tr', {}, el('td', { style: 'color:' + (parseFloat(cpu) > 50 ? 'var(--red)' : parseFloat(cpu) > 20 ? 'var(--yellow)' : 'var(--fg)') }, cpu), el('td', { style: 'color:var(--green)' }, name), el('td', {}, pid), el('td', {}, rss + ' MB'), el('td', {}, thr), el('td', {}, kill, ' ', rest)));
    });
    // 프로세스를 못 찾은 노드도 표시(값 ?) + 액션 제공
    nodes().filter((n) => !seen.has(n)).forEach((name) => {
      const kill = el('button', { class: 'act', onclick: async () => { await post('/api/killnode', { name }); toast('kill ' + name); await refreshGraphNow(); await draw(); setTimeout(refreshGraphNow, 800); } }, 'kill');
      const rest = el('button', { class: 'act', onclick: () => post('/api/restart', { name }).then(() => toast('restart ' + name)) }, 'restart');
      tbl.append(el('tr', { style: 'opacity:.6' }, el('td', {}, '?'), el('td', { style: 'color:var(--green)' }, name), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, '—'), el('td', {}, kill, ' ', rest)));
    });
    wrap.append(tbl);
  };
  draw();
  const iv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(iv); return; } draw(); }, 2000);
}

export async function overview() {
  const wrap = el('div', {});
  openModal('🩻 시스템 개요', wrap);
  const nodes = state.items.filter((i) => i.kind === 'node');
  const vtopics = topics().filter((t) => !(t.name || '').includes('/_action/'));
  const stale = vtopics.filter((t) => t.age > 3), byRate = [...vtopics].sort((a, b) => (b.hz || 0) - (a.hz || 0));
  wrap.append(el('p', {}, `노드 ${nodes.length} · 토픽 ${topics().length} · 서비스 ${state.items.filter((i) => i.kind === 'service').length}`));
  if (stale.length) wrap.append(el('p', { style: 'color:var(--red)' }, '⚠ stale >3s: ' + stale.map((t) => t.name).join(', ')));
  const res = el('pre', { class: 'out' }, '리소스 수집 중…');
  wrap.append(el('h4', {}, '노드 리소스'), res);
  post('/api/resource', { nodes: nodes.map((n) => n.name) }).then((r) => { res.textContent = r.out; });
  const tbl = el('table', { class: 'tbl' });
  tbl.append(el('tr', {}, el('th', {}, '토픽'), el('th', {}, 'Hz')));
  byRate.slice(0, 12).forEach((t) => tbl.append(el('tr', {}, el('td', {}, t.name), el('td', {}, String(t.hz)))));
  wrap.append(el('h4', {}, '최고 rate'), tbl);
}
