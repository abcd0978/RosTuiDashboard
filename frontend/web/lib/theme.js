/* 테마(라이트/다크) — 저장값 우선, 없으면 시스템 설정. data-theme 로 CSS 변수 전환. */

import { $ } from './dom.js';

export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const b = $('#themebtn');
  if (b) {
    b.textContent = t === 'light' ? '☀️' : '🌙';
    b.title = (t === 'light' ? '다크' : '라이트') + ' 테마로 전환';
  }
}

applyTheme(localStorage.getItem('rdash-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

$('#themebtn').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem('rdash-theme', next);
  applyTheme(next);
};
