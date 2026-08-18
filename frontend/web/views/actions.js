/* publish · service · action · msgForm(구 _msgForm) · teleop — 발행/호출/텔레옵 뷰. */

import { $, el, api, post } from '../lib/dom.js';
import { state, byName } from '../lib/state.js';
import { openModal, getActiveModal, setModalSub, toast } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';

export function publish(it) {
  msgForm('▲ publish — ' + it.name, '/api/publish', { name: it.name }, 'msg', '/api/proto?name=' + encodeURIComponent(it.name) + '&type=' + encodeURIComponent(it.ty || ''));
}

export function service(it) {
  msgForm('call service — ' + it.name, '/api/service', { name: it.name }, 'req', '/api/proto?kind=service&name=' + encodeURIComponent(it.name));
}

// GoalStatus.status 정수 → 이름(action_msgs/msg/GoalStatus 상수, 검증됨).
const ACT_STATUS = ['UNKNOWN', 'ACCEPTED', 'EXECUTING', 'CANCELING', 'SUCCEEDED', 'CANCELED', 'ABORTED'];

export function action(it) {
  const name = it.name;
  let ty = '';   // 그래프 스냅샷엔 액션 타입이 없다 — /api/actiontype 로 늦게 채워진다. 타입이 필요한 것들은 전부 이걸 기다린다.
  const tyHint = el('div', { class: 'hint' }, '타입 조회 중…');
  const ta = el('textarea', { rows: 4, style: 'width:100%', html: '{}' });
  const out = el('pre', { class: 'out' });

  // job 폴링 — send 버튼은 job id 만 돌려주고 성공/실패는 안 알려준다(POST /api/action 은
  // spawnJob 결과일 뿐, 실제 goal 수락/거부는 비동기로 잡 로그에 찍힌다). status 가 'run' 을 벗어나거나
  // ~5초가 지날 때까지 /api/jobs 를 폴링해 로그 꼬리를 out 에 그려서, "타입이 잘못됐다" 같은 실패가
  // Jobs 뷰를 따로 열어야만 보이던 문제(이 버그가 숨어 있던 이유)를 없앤다.
  let pollTimer = null;
  const stopPoll = () => { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } };
  const pollJob = (id) => {
    const deadline = Date.now() + 5000;
    const step = async () => {
      pollTimer = null;
      let job = null;
      try { const r = await api('/api/jobs'); job = (r.jobs || []).find((j) => j.id === id); } catch { /* */ }
      if (job) {
        const tail = (job.log || []).slice(-8).join('\n');
        out.textContent = `job ${job.id} [${job.status}]` + (tail ? '\n' + tail : '');
      }
      if (job && job.status !== 'run') return;   // 끝났음(done/error/killed) — 폴링 종료
      if (Date.now() >= deadline) return;         // 타임아웃 — 그냥 마지막 상태로 둔다
      pollTimer = setTimeout(step, 700);
    };
    step();
  };
  const sendBtn = el('button', { class: 'act', disabled: true, onclick: async () => { stopPoll(); out.textContent = '전송 중…'; const r = await post('/api/action', { name, type: ty, goal: ta.value }); out.textContent = 'goal 전송 (job ' + r.id + ')'; pollJob(r.id); } }, 'send goal');
  const cancelBtn = el('button', { class: 'act', onclick: async () => { const r = await post('/api/actioncancel', { name }); out.textContent = r.ok ? `취소 요청 — ${r.canceling}개 취소 중` : ('취소 실패: ' + (r.error || '')); toast(r.ok ? `${r.canceling}개 goal 취소 요청` : '취소 실패', r.ok ? 'ok' : 'err'); } }, 'cancel all');
  const statusPane = el('pre', { class: 'out', style: 'max-height:140px;overflow:auto' }, '(대기 중…)');
  const feedPane = el('pre', { class: 'out', style: 'max-height:200px;overflow:auto' }, '(대기 중…)');
  const feedLines = [];

  openModal('🎯 action — ' + name, el('div', {},
    tyHint,
    el('div', { class: 'hint' }, 'goal (YAML)'), ta,
    el('div', { class: 'actbtns' }, sendBtn, cancelBtn), out,
    el('div', { class: 'hint', style: 'margin-top:10px' }, '상태 (status)'), statusPane,
    el('div', { class: 'hint', style: 'margin-top:10px' }, '피드백 (feedback)'), feedPane));

  // 상태 — action_msgs/msg/GoalStatusArray 는 타입이 고정이라 액션 타입 조회를 기다리지 않고 바로 구독한다.
  const statusSub = openStream('/echo?topic=' + encodeURIComponent(name + '/_action/status') + '&type=' + encodeURIComponent('action_msgs/msg/GoalStatusArray'), (d) => {
    const text = JSON.parse(d);
    // status_list 는 GoalStatus 배열 — msgToYaml 이 객체 배열을 펼치면 항목마다 uuid 다음에 status:N 이
    // 나온다(선언 순서). 짝지어 뽑는다. 최신 스냅샷이 이전 렌더를 그대로 대체한다(로그가 아니라 상태 뷰).
    //
    // rosbridge 는 uint8[16] uuid 를 배열이 아니라 base64 문자열로 준다(실측: "iReeXzJ9Tr+TsKwhc7pr3g==").
    // 그래서 대괄호를 기대하면 영원히 매치되지 않는다 — 공백 없는 토큰으로 받는다.
    const goals = [];
    const re = /uuid:\s*(\S+)[\s\S]*?status:\s*(-?\d+)/g;
    let m;
    while ((m = re.exec(text))) goals.push(`${m[1].slice(0, 8)}  ${ACT_STATUS[+m[2]] || m[2]}`);
    statusPane.textContent = goals.length ? goals.join('\n') : '(진행 중인 goal 없음)';
  });

  let feedSub = null;
  setModalSub({ close: () => { statusSub.close(); if (feedSub) feedSub.close(); stopPoll(); } });   // 셋을 하나로 묶어 모달 닫힐 때 같이 정리

  api('/api/actiontype?name=' + encodeURIComponent(name)).then((r) => {
    ty = (r && r.ty) || '';
    tyHint.textContent = ty || '(타입을 알 수 없음)';
    sendBtn.disabled = false;
    // goal 프리필 — msgForm 과 동일한 규칙(현재 textarea 가 아직 {} 일 때만 덮어씀)
    api('/api/proto?kind=action&name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(ty)).then((rp) => { if (rp && rp.yaml && ta.value.trim() === '{}') ta.value = rp.yaml; }).catch(() => {});
    if (ty) {
      // 피드백 — <ActionType>_FeedbackMessage. 타입 이름 자체가 필요해 조회 전엔 구독할 수 없다.
      feedSub = openStream('/echo?topic=' + encodeURIComponent(name + '/_action/feedback') + '&type=' + encodeURIComponent(ty + '_FeedbackMessage'), (d) => {
        feedLines.push(JSON.parse(d));
        if (feedLines.length > 200) feedLines.shift();
        feedPane.textContent = feedLines.join('\n---\n');
        feedPane.scrollTop = feedPane.scrollHeight;
      });
    }
  }).catch(() => { tyHint.textContent = '(타입 조회 실패)'; sendBtn.disabled = false; });
}

export function msgForm(title, url, base, key, protoUrl) {
  const ta = el('textarea', { rows: 5, style: 'width:100%', html: '{}' });
  const out = el('pre', { class: 'out' });
  const btn = el('button', { class: 'act', onclick: async () => { out.textContent = '전송 중…'; const r = await post(url, { ...base, [key]: ta.value }); out.textContent = r.out; } }, '전송');
  const sel = el('select', { style: 'display:none;width:100%', onchange: () => { ta.value = sel.value; } });   // 프리셋 — 있을 때만 보인다
  openModal(title, el('div', {}, el('div', { class: 'hint' }, key + ' (YAML/JSON)'), sel, ta, el('div', { class: 'actbtns' }, btn), out));
  if (protoUrl) api(protoUrl).then((r) => {
    if (r && r.yaml && ta.value.trim() === '{}') ta.value = r.yaml;
    if (r && r.presets && r.presets.length) {   // 프리셋(shared/pubdefaults.js) — 첫 항목으로 프리필, select 로 전환
      for (const p of r.presets) sel.append(el('option', { value: p.yaml }, p.yaml));
      sel.style.display = ''; ta.value = r.presets[0].yaml;
    }
  }).catch(() => {});
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
