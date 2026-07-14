/* 사이드바 — TUI 식 접기/펼치기 트리(이름을 '/' 로 계층화) */

import { $, el, post, emptyState, spinner } from '../lib/dom.js';
import { state, isAnon, visible } from '../lib/state.js';
import { wsEverOpen } from '../lib/stream.js';
import { renderInfo } from './info.js';
import { selectTopic, resetSeriesForPick, renderValActs } from './value.js';

const treeCollapsed = new Set();   // 접힌 경로(kind\0/a/b) — 렌더 사이 유지. kind\0 = 섹션 전체.

const toggleCollapse = (key) => { treeCollapsed.has(key) ? treeCollapsed.delete(key) : treeCollapsed.add(key); renderSidebar(); };

// 이름 세그먼트로 중첩 트리. 폴더가 곧 항목일 수도 있음(item + children 동시).
export function buildPathTree(arr) {
  const root = { children: new Map() };
  for (const it of arr) {
    const segs = it.name.replace(/^\//, '').split('/');
    let node = root, acc = '';
    for (let i = 0; i < segs.length; i++) {
      acc += '/' + segs[i];
      if (!node.children.has(segs[i])) node.children.set(segs[i], { children: new Map(), item: null, full: acc, seg: segs[i] });
      node = node.children.get(segs[i]);
      if (i === segs.length - 1) node.item = it;
    }
  }
  return root;
}

export function leafCount(node) {
  let n = node.item ? 1 : 0;
  for (const c of node.children.values()) n += leafCount(c);
  return n;
}

// 토픽 hz 배지(라이브/정지)
export function badge(it) {
  if (it.kind !== 'topic') return el('span');
  const live = it.hz > 0.1, stale = !live && it.age > 3;
  return el('span', { class: 'hz ' + (live ? 'live' : stale ? 'stale' : '') }, String(it.hz ?? ''));
}

export function deadMark(it) {
  return it.kind === 'topic' && it.pubs ? ((it.pubs.length && !(it.subs || []).length) ? ' ⇢' : (!it.pubs.length && (it.subs || []).length ? ' ⇠' : '')) : '';
}

// 사이드바에 실제로 보이는 토픽만 서버에 알려 Hz 측정 대상 축소(디바운스 300ms, 바뀔 때만 POST). post()는 기존 헬퍼 재사용.
let measureTimer = null, measureSent = null;

export function scheduleMeasure(vis) {
  const set = new Set(vis);
  if (state.selItem && state.selItem.kind === 'topic') set.add(state.selItem.name);
  const list = [...set].sort();
  clearTimeout(measureTimer);
  measureTimer = setTimeout(() => { const key = list.join('\0'); if (key === measureSent) return; measureSent = key; post('/api/measure', { topics: list }); }, 300);
}

export function renderTree(kind, node, depth, H, VT) {
  const kids = [...node.children.values()].sort((a, b) => a.seg.localeCompare(b.seg));
  for (const c of kids) {
    const hasKids = c.children.size > 0, key = kind + '\0' + c.full, collapsed = treeCollapsed.has(key), pad = 10 + depth * 13;
    const caret = el('span', { class: 'tcaret' }, hasKids ? (collapsed ? '▸' : '▾') : '');
    const nameCls = (hasKids && !c.item ? 'tdir' : 'k-' + kind) + ' tname';
    const label = (c.item && state.marked.has(c.item.name) ? '*' : '') + c.seg + (c.item ? deadMark(c.item) : '');
    const cnt = hasKids && collapsed ? el('span', { class: 'tcount' }, '(' + leafCount(c) + ')') : null;
    const left = el('span', { style: 'display:flex;align-items:center;gap:2px;min-width:0;flex:1' }, caret, el('span', { class: nameCls }, label), ...(cnt ? [cnt] : []));
    const isSel = c.item && state.sel === c.item.name;
    const row = el('div', { class: 'row' + (isSel ? ' sel' : ''), style: 'padding-left:' + pad + 'px', title: c.full }, left, c.item ? badge(c.item) : el('span'));
    if (hasKids) caret.onclick = (e) => { e.stopPropagation(); toggleCollapse(key); };
    row.onclick = () => { if (c.item) onPick(c.item); else if (hasKids) toggleCollapse(key); };
    H.push(row);
    if (c.item && VT) VT.push(c.item.name);
    if (hasKids && !collapsed) renderTree(kind, c, depth + 1, H, VT);
  }
}

export function renderSidebar() {
  const groups = {};
  for (const it of visible()) (groups[it.kind] || (groups[it.kind] = [])).push(it);
  const titles = { topic: '토픽', action: '액션', node: '노드', service: '서비스', param: '파라미터' };
  const H = [], VT = [];   // VT: 실제로 보이는(접힌 그룹 안이 아닌) 토픽 이름 — Hz 측정 대상 후보
  for (const k of ['topic', 'action', 'node', 'service', 'param']) {
    const arr = (groups[k] || []);
    if (!arr.length) continue;
    const secKey = k + '\0', secCollapsed = treeCollapsed.has(secKey);
    const sec = el('div', { class: 'sec', style: 'cursor:pointer;display:flex;align-items:center;gap:4px' }, el('span', { class: 'tcaret' }, secCollapsed ? '▸' : '▾'), `${titles[k] || k} (${arr.length})`);
    sec.onclick = () => toggleCollapse(secKey);
    H.push(sec);
    if (secCollapsed) continue;
    renderTree(k, buildPathTree(arr), 0, H, k === 'topic' ? VT : null);
  }
  scheduleMeasure(VT);
  const side = $('#side');
  side.innerHTML = '';
  // 필터 툴바 — CLI/도구 익명 항목(ros_tui*, rostopic_* 등) 숨김 토글.
  const anonN = state.items.filter((i) => isAnon(i.name) && !(i.name || '').includes('/_action/')).length;
  const cb = el('input', { type: 'checkbox' });
  cb.checked = state.hideAnon;
  cb.onchange = () => { state.hideAnon = cb.checked; renderSidebar(); };
  side.append(el('label', { style: 'display:flex;align-items:center;gap:5px;padding:5px 10px;font-size:11px;border-bottom:1px solid var(--line);cursor:pointer' }, cb, el('span', {}, `익명 노드/서비스 숨김${anonN ? ` (${anonN})` : ''}`)));
  if (!H.length) { side.append(state.items.length ? emptyState('🔍', '표시할 항목 없음', '필터를 확인하세요') : (wsEverOpen() ? emptyState('📡', 'ROS 그래프가 비어 있음', '실행 중인 노드/토픽이 없습니다') : spinner('그래프 수집 중…'))); return; }
  H.forEach((x) => side.append(x));
}

export function onPick(it) {
  state.sel = it.name;
  state.selItem = it;
  renderSidebar();
  if (it.kind === 'topic') selectTopic(it.name);
  else resetSeriesForPick(it);
  renderInfo(it);
  renderValActs();
}
