/* publish · service · action · msgForm(구 _msgForm) · teleop — 발행/호출/텔레옵 뷰. */

import { $, el, api, post } from '../lib/dom.js';
import { state, byName } from '../lib/state.js';
import { openModal, getActiveModal } from '../lib/modal.js';

export function publish(it) {
  msgForm('▲ publish — ' + it.name, '/api/publish', { name: it.name }, 'msg', '/api/proto?name=' + encodeURIComponent(it.name) + '&type=' + encodeURIComponent(it.ty || ''));
}

export function service(it) {
  msgForm('call service — ' + it.name, '/api/service', { name: it.name }, 'req', '/api/proto?kind=service&name=' + encodeURIComponent(it.name));
}

export function action(it) {
  const ta = el('textarea', { rows: 4, style: 'width:100%', html: '{}' });
  const out = el('pre', { class: 'out' });
  const btn = el('button', { class: 'act', onclick: async () => { const r = await post('/api/action', { name: it.name, type: it.ty || '', goal: ta.value }); out.textContent = 'goal 전송 (job ' + r.id + ') — Jobs 에서 피드백'; } }, 'send goal');
  openModal('🎯 action goal — ' + it.name, el('div', {}, el('div', { class: 'hint' }, 'goal (YAML)'), ta, el('div', { class: 'actbtns' }, btn), out));
}

export function msgForm(title, url, base, key, protoUrl) {
  const ta = el('textarea', { rows: 5, style: 'width:100%', html: '{}' });
  const out = el('pre', { class: 'out' });
  const btn = el('button', { class: 'act', onclick: async () => { out.textContent = '전송 중…'; const r = await post(url, { ...base, [key]: ta.value }); out.textContent = r.out; } }, '전송');
  openModal(title, el('div', {}, el('div', { class: 'hint' }, key + ' (YAML/JSON)'), ta, el('div', { class: 'actbtns' }, btn), out));
  if (protoUrl) api(protoUrl).then((r) => { if (r && r.yaml && ta.value.trim() === '{}') ta.value = r.yaml; }).catch(() => {});
}

export function teleop() {
  // 텔레옵 대상 후보 — Twist/TwistStamped 를 구독하는 cmd_vel 계열 토픽 자동 감지.
  const cand = state.items.filter((i) => i.kind === 'topic' && /Twist/.test(i.ty || '')).map((i) => i.name);
  const tyOf = (name) => { const it = byName(name); return /TwistStamped/.test(it && it.ty || '') ? 'twiststamped' : 'twist'; };
  // 기본 토픽: turtlesim(/turtle1/cmd_vel) > 감지된 첫 후보 > /cmd_vel.
  const def = cand.includes('/turtle1/cmd_vel') ? '/turtle1/cmd_vel' : (cand[0] || '/cmd_vel');
  const dl = el('datalist', { id: 'teleoptopics' });
  cand.forEach((t) => dl.append(el('option', { value: t })));
  const topic = el('input', { value: def, list: 'teleoptopics', style: 'width:190px' });
  const tySel = el('select', { style: 'font:11px monospace' },
    el('option', { value: 'auto' }, '자동'), el('option', { value: 'twist' }, 'Twist'), el('option', { value: 'twiststamped' }, 'TwistStamped'));
  const msgTy = () => tySel.value === 'auto' ? tyOf(topic.value) : tySel.value;
  const tyLbl = el('span', { class: 'hint', style: 'font-family:monospace' });
  const refreshTy = () => { tyLbl.textContent = `→ geometry_msgs/${msgTy() === 'twiststamped' ? 'TwistStamped' : 'Twist'}`; };
  topic.oninput = refreshTy;
  tySel.onchange = refreshTy;
  refreshTy();
  const lin = el('input', { type: 'number', value: '0.5', step: '0.1', style: 'width:64px' });
  const ang = el('input', { type: 'number', value: '1.0', step: '0.1', style: 'width:64px' });
  // 프리셋 — 대상별 토픽·메시지·권장 속도를 한 번에. custom 은 아래 입력 그대로 사용.
  const PRESETS = [
    { id: 'turtle', label: 'turtlesim  ·  /turtle1/cmd_vel  ·  Twist', topic: '/turtle1/cmd_vel', ty: 'twist', lin: 2.0, ang: 2.0 },
    { id: 'diff', label: '디프드라이브(turtlebot 등)  ·  /cmd_vel  ·  Twist', topic: '/cmd_vel', ty: 'twist', lin: 0.5, ang: 1.0 },
    { id: 'mavros', label: 'MAVROS 속도  ·  /mavros/setpoint_velocity/cmd_vel  ·  TwistStamped', topic: '/mavros/setpoint_velocity/cmd_vel', ty: 'twiststamped', lin: 0.5, ang: 0.5 },
    { id: 'custom', label: '직접 입력 (아래 토픽/타입 사용)', topic: null },
  ];
  const presetSel = el('select', { style: 'width:100%' });
  PRESETS.forEach((p) => presetSel.append(el('option', { value: p.id }, p.label)));
  const applyPreset = (pid) => { const p = PRESETS.find((x) => x.id === pid); if (!p || !p.topic) return; topic.value = p.topic; tySel.value = p.ty; lin.value = String(p.lin); ang.value = String(p.ang); refreshTy(); };
  presetSel.onchange = () => applyPreset(presetSel.value);
  const initId = (PRESETS.find((p) => p.topic === def) || { id: 'custom' }).id;   // 감지된 기본 토픽에 맞춰 초기 프리셋
  presetSel.value = initId;
  if (initId !== 'custom') applyPreset(initId);
  const status = el('span', { class: 'hint' }, '■ 정지');
  let held = null;
  const send = (dx, dz) => {
    const dir = dx + ',' + dz;
    if (dir === held) return;
    held = dir;
    post('/api/teleop', { topic: topic.value, ty: msgTy(), lin: dx * (+lin.value || 0), ang: dz * (+ang.value || 0) }).then(() => { status.textContent = `▶ ${topic.value}  lin ${(dx * lin.value).toFixed(2)}  ang ${(dz * ang.value).toFixed(2)}`; });
  };
  const stop = () => { held = null; post('/api/teleop', { topic: topic.value, stop: true }).then(() => { status.textContent = '■ 정지'; }); };
  const B = (label, dx, dz) => { const b = el('button', { class: 'act', style: 'width:52px;height:44px;font-size:18px' }, label); b.onmousedown = () => send(dx, dz); b.onmouseup = stop; b.onmouseleave = () => { if (held) stop(); }; return b; };
  const stopBtn = el('button', { class: 'act', style: 'width:52px;height:44px;font-size:18px', onclick: stop }, '■');
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(3,52px);gap:6px;justify-content:center;margin:12px 0' },
    el('span'), B('▲', 1, 0), el('span'), B('◀', 0, 1), stopBtn, B('▶', 0, -1), el('span'), B('▼', -1, 0), el('span'));
  openModal('🎮 Teleop (Twist)', el('div', {}, dl,
    el('div', { class: 'hint', style: 'margin-bottom:6px' }, '프리셋 ', presetSel),
    el('div', { class: 'hint', style: 'margin-bottom:6px' }, '토픽 ', topic, ' ', tySel, ' ', tyLbl),
    el('div', { class: 'hint', style: 'margin-bottom:6px' }, '선속 ', lin, ' m/s  각속 ', ang, ' rad/s'),
    grid, el('div', { class: 'hint' }, '버튼/키를 누르는 동안 -r 10 Hz 발행 · 놓으면 정지 · W/A/S/D·↑←↓→, Space=정지'),
    el('div', { class: 'hint', style: 'margin-top:4px;line-height:1.5' }, 'turtlesim → /turtle1/cmd_vel · 디프드라이브 → /cmd_vel · MAVROS → /mavros/setpoint_velocity/cmd_vel (TwistStamped, OFFBOARD+ARM 필요).', el('br'), '⚠ 순수 PX4(px4_msgs)는 Twist 를 안 받음 — 오프보드 setpoint(TrajectorySetpoint+OffboardControlMode) 필요.'),
    status));
  const KM = { w: [1, 0], ArrowUp: [1, 0], s: [-1, 0], ArrowDown: [-1, 0], a: [0, 1], ArrowLeft: [0, 1], d: [0, -1], ArrowRight: [0, -1] };
  const teleopKey = (e) => KM[e.key] || KM[String(e.key || '').toLowerCase()];
  const takeKey = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const kd = (e) => {
    if (!$('#modal').classList.contains('on')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === ' ') { takeKey(e); stop(); return; }
    const m = teleopKey(e);
    if (m) { takeKey(e); send(m[0], m[1]); }
  };
  const ku = (e) => { if (!$('#modal').classList.contains('on')) return; if (teleopKey(e)) { takeKey(e); stop(); } };
  window.addEventListener('keydown', kd, true);
  window.addEventListener('keyup', ku, true);
  getActiveModal().close = () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); stop(); };
}
