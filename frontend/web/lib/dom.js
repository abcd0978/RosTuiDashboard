/* RDash 웹 프론트엔드 — 순수 DOM/네트워크 헬퍼. el/$/api/post/spinner/emptyState + SNAP 플래그. */

export const $ = (s) => document.querySelector(s);

export const el = (t, a = {}, ...kids) => {
  const e = document.createElement(t);
  for (const k in a) {
    if (k === 'class') e.className = a[k];
    else if (k === 'html') e.innerHTML = a[k];
    else if (k.startsWith('on')) e[k] = a[k];
    else e.setAttribute(k, a[k]);
  }
  for (const c of kids) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

export const api = (u, opt) => fetch(u, opt).then((r) => r.json());

export const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

export const SNAP = location.search.includes('snap');

// 로딩 스피너 · 빈 상태 — 일관된 대기/무데이터 표현.
export const spinner = (msg = '불러오는 중…') => el('div', { class: 'loading' }, el('span', { class: 'spin' }), msg);

export const emptyState = (ic, msg, sub) => el('div', { class: 'empty' }, el('div', { class: 'ic' }, ic), el('div', { class: 'msg' }, msg), sub ? el('div', { class: 'sub hint' }, sub) : document.createTextNode(''));
