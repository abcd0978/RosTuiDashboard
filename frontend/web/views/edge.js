/* 엣지 클릭 → 상세 팝업 — 노드↔노드 토픽 엣지(집계)·이분 그래프 pub/sub 엣지·서비스·액션 엣지 각각의 세부정보. */

import { el } from '../lib/dom.js';
import { byName, nodeName } from '../lib/state.js';
import { openModal, closeModal } from '../lib/modal.js';
import { selectTopic } from '../panels/value.js';

const REL = (r) => (r === 'R' ? 'RELIABLE' : r === 'B' ? 'BEST_EFFORT' : '');
const DUR = (d) => (d === 'T' ? 'TRANSIENT_LOCAL' : d === 'V' ? 'VOLATILE' : '');

// 방향(pubNode→subNode) 기준 QoS 문자열 — 둘 다 없으면 null(컬럼 자체를 생략하기 위함).
function qosStr(t, pubNode, subNode) {
  const parts = [];
  if (pubNode) {
    const p = (t.pubs || []).find((x) => nodeName(x) === pubNode);
    if (Array.isArray(p) && (p[1] || p[2])) parts.push('pub ' + [REL(p[1]), DUR(p[2])].filter(Boolean).join('/'));
  }
  if (subNode) {
    const s = (t.subs || []).find((x) => nodeName(x) === subNode);
    if (Array.isArray(s) && (s[1] || s[2])) parts.push('sub ' + [REL(s[1]), DUR(s[2])].filter(Boolean).join('/'));
  }
  return parts.length ? parts.join(' · ') : null;
}

function openTopicsModal(e) {
  const names = e.kind === 'topic' ? e.labels : e.kind === 'pub' ? [e.to] : [e.from];
  const pubNode = e.kind === 'sub' ? null : e.from;
  const subNode = e.kind === 'pub' ? null : e.to;
  const items = names.map((n) => byName(n));
  const anyQos = items.some((t) => t && qosStr(t, pubNode, subNode));
  const cols = anyQos ? 7 : 6;
  const tbl = el('table', { class: 'tbl' });
  const head = [el('th', {}, '토픽'), el('th', {}, '타입'), el('th', {}, 'Hz'), el('th', {}, 'age'), el('th', {}, 'pubs'), el('th', {}, 'subs')];
  if (anyQos) head.push(el('th', {}, 'QoS'));
  tbl.append(el('tr', {}, ...head));
  names.forEach((n, i) => {
    const t = items[i];
    if (!t) { tbl.append(el('tr', {}, el('td', { colspan: cols }, n + ' (정보 없음)'))); return; }
    const cells = [
      el('td', {}, n),
      el('td', {}, t.ty || '?'),
      el('td', {}, t.hz == null ? '—' : (+t.hz).toFixed(2)),
      el('td', {}, t.age != null ? t.age + 's' : '—'),
      el('td', {}, String((t.pubs || []).length)),
      el('td', {}, String((t.subs || []).length)),
    ];
    if (anyQos) cells.push(el('td', {}, qosStr(t, pubNode, subNode) || '—'));
    const tr = el('tr', { style: 'cursor:pointer' }, ...cells);
    tr.onclick = () => { selectTopic(n); closeModal(); };
    tbl.append(tr);
  });
  const cnt = names.length > 1 ? ` (${names.length}개 토픽)` : '';
  openModal(`🔗 ${e.from} → ${e.to}${cnt}`, tbl);
}

function openServiceModal(e) {
  const node = e.from, svc = e.to, s = byName(svc);
  const tbl = el('table', { class: 'tbl' },
    el('tr', {}, el('th', {}, '항목'), el('th', {}, '값')),
    el('tr', {}, el('td', {}, '서비스'), el('td', {}, svc)),
    ...(s && s.ty ? [el('tr', {}, el('td', {}, '타입'), el('td', {}, s.ty))] : []),
    el('tr', {}, el('td', {}, '제공 노드'), el('td', {}, node)));
  openModal(`🔧 ${node} → ${svc}`, tbl);
}

function openActionModal(e) {
  const fromIsNode = (byName(e.from) || {}).kind === 'node';
  const node = fromIsNode ? e.from : e.to, action = fromIsNode ? e.to : e.from;
  const a = byName(action);
  const tbl = el('table', { class: 'tbl' },
    el('tr', {}, el('th', {}, '항목'), el('th', {}, '값')),
    el('tr', {}, el('td', {}, '액션'), el('td', {}, action)),
    ...(a && a.ty ? [el('tr', {}, el('td', {}, '타입'), el('td', {}, a.ty))] : []),
    el('tr', {}, el('td', {}, '노드'), el('td', {}, node)));
  openModal(`🎬 ${e.from} → ${e.to}`, tbl);
}

export function openEdgeModal(e) {
  if (e.kind === 'service') return openServiceModal(e);
  if (e.kind === 'action') return openActionModal(e);
  openTopicsModal(e);
}
