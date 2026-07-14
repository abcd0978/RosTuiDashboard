/* 모달 + 토스트. activeModal/modalSub 는 여러 뷰 모듈에서 재할당되므로(원래 전역 재대입)
   getActiveModal()/setModalSub() 로 캡슐화한다(모듈 바깥에서 import 바인딩을 직접 재대입할 수 없음). */

import { $, el } from './dom.js';

let activeModal = null;
let modalSub = null;   // 모달이 연 SSE

export function openModal(title, node, refresh) {
  $('#mtitle').textContent = title;
  const b = $('#mbody');
  b.innerHTML = '';
  b.append(node);
  $('#modal').classList.add('on');
  activeModal = { refresh, close: () => {} };
}

export function closeModal() {
  $('#modal').classList.remove('on');
  if (activeModal && activeModal.close) { try { activeModal.close(); } catch (_) { /* */ } }
  if (modalSub) { modalSub.close(); modalSub = null; }
  activeModal = null;
}

export function getActiveModal() {
  return activeModal;
}

export function setModalSub(v) {
  modalSub = v;
}

// 토스트 — 우하단에 뜨는 알림(레벨: ok/warn/err/info). 연결 배지를 덮어쓰지 않는다.
export function toast(msg, level = 'info') {
  const wrap = $('#toasts');
  if (!wrap) return;
  const ICON = { ok: '✓', warn: '▲', err: '✕', info: 'ℹ' };
  const t = el('div', { class: 'toast ' + level }, el('span', { class: 'ti', style: 'color:var(--' + ({ ok: 'green', warn: 'yellow', err: 'red', info: 'cyan' }[level]) + ')' }, ICON[level] || 'ℹ'), el('span', {}, String(msg)));
  wrap.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 3200);
}
