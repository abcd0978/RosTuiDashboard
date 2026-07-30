/* overlays — ROS 워크스페이스 오버레이 선택. shared/overlays.js 참조: rosSpawn(비로그인 셸)은
   백엔드를 띄운 셸이 오버레이를 소싱했든 안 했든 distro 만 상속한다(검증됨) — custom action/msg
   타입(mini_mission_interfaces 등)은 여기서 켜지 않으면 goal 전송/echo 가 조용히(타입 오류로) 실패한다. */
import { el, api, post } from '../lib/dom.js';
import { openModal, toast } from '../lib/modal.js';

export function overlays() {
  const wrap = el('div', {});
  openModal('⚙ ROS 워크스페이스 오버레이', wrap);
  const draw = async () => {
    const r = await api('/api/overlays');
    const candidates = r.candidates || [], enabledSet = new Set(r.enabled || []);
    // 후보(candidates)엔 없지만 이미 켜져 있는 경로(과거에 손으로 추가한 것)도 목록에 남긴다.
    const paths = [...new Set([...candidates, ...enabledSet])].sort();
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'hint', style: 'margin-bottom:8px;line-height:1.5' },
      '체크한 오버레이가 goal 전송·echo 등 모든 명령 앞에 소스됩니다 — 메시지/액션 패키지가 배포판이 아니라 워크스페이스에만 있을 때(예: mini_mission_interfaces) 필요합니다. 저장하면 rosbridge 가 재시작됩니다(최대 5초, 커스텀 타입 역직렬화용) — CLI 명령(goal 전송 등)은 저장 즉시 반영됩니다.'));
    const tbl = el('table', { class: 'tbl' });
    const boxes = new Map();   // path → checkbox
    const addRow = (p, checked) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = checked;
      boxes.set(p, cb);
      tbl.append(el('tr', {}, el('td', {}, cb), el('td', { style: 'font-family:monospace' }, p)));
    };
    paths.forEach((p) => addRow(p, enabledSet.has(p)));
    wrap.append(tbl);

    const addInput = el('input', { placeholder: '/path/to/install/setup.bash', style: 'width:60%' });
    const addBtn = el('button', {
      class: 'act',
      onclick: () => { const p = addInput.value.trim(); if (p && !boxes.has(p)) addRow(p, true); addInput.value = ''; },
    }, '추가');
    wrap.append(el('div', { class: 'actbtns', style: 'margin-top:6px' }, addInput, addBtn));

    const out = el('pre', { class: 'out' });
    const saveBtn = el('button', {
      class: 'act',
      onclick: async () => {
        const enabledList = [...boxes.entries()].filter(([, cb]) => cb.checked).map(([p]) => p);
        out.textContent = '저장 중…';
        const r2 = await post('/api/overlays', { enabled: enabledList });
        out.textContent = `저장됨 (${(r2.enabled || []).length}개 활성) — rosbridge 재시작 중, 수 초 후 반영`;
        toast('오버레이 저장됨', 'ok');
      },
    }, '저장');
    wrap.append(el('div', { class: 'actbtns', style: 'margin-top:8px' }, saveBtn), out);
  };
  draw();
}
