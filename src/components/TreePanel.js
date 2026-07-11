// 왼쪽 "파일 컴포넌트" — ROS 그래프 네임스페이스 트리. 네비게이션·전역 키를 자기 책임에서 처리.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { pad, padL, sparkline, LEFT_W } from '../lib/util.js';

export function TreePanel() {
  const d = useDashboard();
  const { flat, top: dtop, sel: dsel, VISIBLE, LW, expanded, hzHistRef, hoverIdx } = d;

  // ROS 데이터 도착 전/그래프 비었을 때 트리 자리 힌트(연결 상태별)
  const emptyHint = !d.ver ? 'ROS 버전 감지 중…'
    : d.topics == null ? (d.conn === 'reconnecting' ? 'ROS 재연결 중…' : d.conn === 'exec-error' ? 'python3/ROS 확인' : 'ROS 연결 중…')
    : '노드 없음 — 실행되면 자동 표시';

  const win = Array.from({ length: VISIBLE }, (_, i) => flat[dtop + i] || null);
  const treeRows = win.map((r, i) => {
    if (!r && flat.length === 0 && i === 0) return h(Box, { key: i }, h(Text, { color: 'yellow' }, ' ' + emptyHint));
    if (!r) return h(Box, { key: i }, h(Text, null, ' '));
    const selected = (dtop + i === dsel);
    const hovered = !selected && (dtop + i === hoverIdx);   // 마우스 호버 하이라이트
    const it = r.node.item;
    const kind = it && it.kind;
    const isTopic = kind === 'topic';
    const live = isTopic && (it.hz || 0) > 0.1;
    const stale = isTopic && !live && it.age != null && it.age > 3;   // 발행하다 멈춤(수신 후 3s+)
    const twist = r.hasKids ? (expanded.has(r.node.path) ? '▼' : '▶') : ' ';
    const mark = !it ? '' : (isTopic ? (live ? '●' : stale ? '⚠' : '·') : { param: 'P', service: 'S', node: 'N' }[kind] || '·');
    const nameCol = '  '.repeat(r.depth) + twist + ' ' + (it ? mark + ' ' : '') + r.node.name + (it && it.sub ? ' (sub)' : '');
    const hz = isTopic ? String(it.hz) : '';
    const spark = isTopic ? sparkline(hzHistRef.current.get(it.p), 5) : '';   // Hz 미니 히스토리
    const line = pad(nameCol, LW - 10) + pad(spark, 5) + ' ' + padL(hz, 4);
    const kindColor = { param: 'magenta', service: 'blue', node: 'green' }[kind];
    return h(Box, { key: i },
      h(Text, {
        backgroundColor: selected ? 'cyan' : hovered ? 'blue' : undefined,
        color: selected ? 'black' : hovered ? 'white' : (it ? (isTopic ? (live ? undefined : stale ? 'red' : 'gray') : kindColor) : 'yellow'),
        bold: selected || hovered || (r.hasKids && !it),
      }, pad(line, LW)));
  });

  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: LEFT_W, paddingX: 1 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'cyan' }, ` ROS${d.ver || '?'} `),
      h(Text, { dimColor: true }, `${d.list.length}${d.conn === 'ok' ? '' : ' [' + d.conn + ']'}`)),
    h(Box, { ref: d.listRef, flexDirection: 'column' }, ...treeRows));
}
