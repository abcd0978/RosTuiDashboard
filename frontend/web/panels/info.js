/* 우측 '선택 값' 상단 정보 블록 — 토픽/노드/서비스/파라미터/액션 공통. 토픽은 rostopic info(타입·Hz·발행자·구독자). */

import { $, el, api } from '../lib/dom.js';
import { state, byName, nodeName } from '../lib/state.js';
import { onPick } from './sidebar.js';
import { setGraphHover } from '../views/graph.js';

export const kindIcon = (k) => ({ topic: '📩', node: '🔩', service: '🔧', param: '⚙', action: '🎬' })[k] || '•';

// 노드가 발행/구독하는 토픽 — items 를 훑어 이 노드가 pubs/subs 에 든 토픽을 모은다(rosnode info 요약).
export function nodeTopics(node) {
  const P = [], S = [];
  for (const it of state.items) {
    if (it.kind !== 'topic') continue;
    if ((it.pubs || []).some((e) => nodeName(e) === node)) P.push(it.name);
    if ((it.subs || []).some((e) => nodeName(e) === node)) S.push(it.name);
  }
  return { pubs: P.sort(), subs: S.sort() };
}

// 파라미터 현재값 — 선택 시 1회 조회(ROS1 rosparam get). 캐시로 텔레메트리 갱신마다 재요청 방지.
let paramVal = { name: null, text: '' };

export function fetchParamVal(name) {
  paramVal = { name, text: '조회 중…' };
  api('/api/param/get1?name=' + encodeURIComponent(name)).then((r) => {
    if (state.selItem && state.selItem.name === name) { paramVal = { name, text: (r && r.out ? r.out : '(값 없음)') }; renderInfo(state.selItem); }
  }).catch(() => {});
}

export function renderInfo(it) {
  const box = $('#valinfo');
  if (!box) return;
  box.innerHTML = '';
  box.onmouseleave = () => setGraphHover(null);   // 텔레메트리 갱신이 호버 중인 .ilink 를 갈아끼워 개별 mouseleave 가 유실될 수 있다 — 컨테이너에서 확실히 해제(컨테이너는 재생성 안 됨)
  if (!it) return;
  const line = (label, val, cls) => el('div', { class: 'irow' }, el('span', { class: 'ilabel' }, label), el('span', { class: cls || '' }, val));
  const list = (label, arr, empty, hoverKind) => {
    const wrap = el('div', { class: 'ilist' });
    wrap.append(el('span', { class: 'ilabel' }, `${label} (${arr.length})`));
    if (!arr.length) wrap.append(el('div', { class: 'hint', style: 'padding-left:8px' }, empty));
    else arr.forEach((n) => {
      const r = el('div', { class: 'ilink', style: 'padding-left:8px' }, n);
      r.onclick = () => { const t = byName(n) || { kind: 'node', name: n }; onPick(t); };
      if (hoverKind) { r.onmouseenter = () => setGraphHover(hoverKind, n); r.onmouseleave = () => setGraphHover(null); }
      wrap.append(r);
    });
    return wrap;
  };
  if (it.kind === 'topic') {
    const t = byName(it.name) || it;
    box.append(line('타입', t.ty || '?', 'imono'));
    box.append(line('Hz', `${t.hz != null ? t.hz : '—'}${t.age != null ? `   · age ${t.age}s` : ''}`, 'imono'));
    box.append(list('발행자 Publishers', (t.pubs || []).map(nodeName), '없음', 'node'));
    box.append(list('구독자 Subscribers', (t.subs || []).map(nodeName), '없음', 'node'));
  } else if (it.kind === 'node') {
    const nt = nodeTopics(it.name);
    box.append(line('노드', it.name, 'imono'));
    box.append(list('발행 Publications', nt.pubs, '없음', 'topic'));
    box.append(list('구독 Subscriptions', nt.subs, '없음', 'topic'));
  } else if (it.kind === 'service') {
    const s = byName(it.name) || it;
    box.append(line('서비스', it.name, 'imono'));
    if (s.ty) box.append(line('타입', s.ty, 'imono'));
    box.append(list('서버 노드', (s.server || []).map(nodeName), '—'));
  } else if (it.kind === 'param') {
    box.append(line('파라미터', it.name, 'imono'));
    if (paramVal.name !== it.name) fetchParamVal(it.name);   // 선택 바뀔 때만 1회 조회(텔레메트리 갱신마다 재요청 방지)
    box.append(line('값', paramVal.name === it.name ? paramVal.text : '조회 중…', 'imono'));
    box.append(el('div', { class: 'hint', style: 'margin-top:2px' }, "‘set’ 으로 변경"));
  } else if (it.kind === 'action') {
    box.append(line('액션', it.name, 'imono'));
  }
}
