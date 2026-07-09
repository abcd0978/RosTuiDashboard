// 왼쪽 "파일 컴포넌트" — ROS 그래프 네임스페이스 트리. 네비게이션·전역 키를 자기 책임에서 처리.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { pad, padL, sparkline, clamp, RATES, LEFT_W } from '../lib/util.js';

export function TreePanel() {
  const d = useDashboard();
  const { flat, top: dtop, sel: dsel, VISIBLE, LW, expanded, hzHistRef } = d;

  // 오버레이(편집/필드선택/검색)가 없을 때만 트리 키 활성 → 입력이 올바른 컴포넌트로 전파
  const navActive = !!process.stdin.isTTY && !d.edit && !d.plotPick && !d.searching;
  useInput((ch, key) => {
    if (ch === 'q') d.quit();
    else if (ch === '/') d.setSearching(true);
    else if (ch === ' ') d.setFrozen((f) => !f);
    else if (key.escape && d.filter) d.setFilter('');
    else if (key.downArrow || ch === 'j') d.move(1);
    else if (key.upArrow || ch === 'k') d.move(-1);
    else if (key.pageDown) d.move(VISIBLE);
    else if (key.pageUp) d.move(-VISIBLE);
    else if (key.return || key.rightArrow || ch === 'l') d.activate(dsel);
    else if (ch === 'x') d.doAction();
    else if (ch === 'p') d.doPlot();
    else if (ch === 'r') d.doRestart();
    else if (ch === 'g') { d.setSel(0); d.setTop(0); }
    else if (ch === 'G') { d.setSel(Math.max(0, d.n - 1)); d.setTop(d.maxTop); }
    else if (ch === '+' || ch === '=') d.setRateIdx((i) => clamp(i + 1, 0, RATES.length - 1));
    else if (ch === '-' || ch === '_') d.setRateIdx((i) => clamp(i - 1, 0, RATES.length - 1));
    else if (ch === ']') d.setValTop((v) => clamp(v + 3, 0, d.valMaxRef.current));
    else if (ch === '[') d.setValTop((v) => clamp(v - 3, 0, d.valMaxRef.current));
  }, { isActive: navActive });

  const win = Array.from({ length: VISIBLE }, (_, i) => flat[dtop + i] || null);
  const treeRows = win.map((r, i) => {
    if (!r) return h(Box, { key: i }, h(Text, null, ' '));
    const selected = (dtop + i === dsel);
    const it = r.node.item;
    const kind = it && it.kind;
    const isTopic = kind === 'topic';
    const live = isTopic && (it.hz || 0) > 0.1;
    const twist = r.hasKids ? (expanded.has(r.node.path) ? '▼' : '▶') : ' ';
    const mark = !it ? '' : (isTopic ? (live ? '●' : '·') : { param: 'P', service: 'S', node: 'N' }[kind] || '·');
    const nameCol = '  '.repeat(r.depth) + twist + ' ' + (it ? mark + ' ' : '') + r.node.name + (it && it.sub ? ' (sub)' : '');
    const hz = isTopic ? String(it.hz) : '';
    const spark = isTopic ? sparkline(hzHistRef.current.get(it.p), 5) : '';   // Hz 미니 히스토리
    const line = pad(nameCol, LW - 10) + pad(spark, 5) + ' ' + padL(hz, 4);
    const kindColor = { param: 'magenta', service: 'blue', node: 'green' }[kind];
    return h(Box, { key: i },
      h(Text, {
        backgroundColor: selected ? 'cyan' : undefined,
        color: selected ? 'black' : (it ? (isTopic ? (live ? undefined : 'gray') : kindColor) : 'yellow'),
        bold: selected || (r.hasKids && !it),
      }, pad(line, LW)));
  });

  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: LEFT_W, paddingX: 1 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'cyan' }, ` ROS${d.ver || '?'} `),
      h(Text, { dimColor: true }, `${d.list.length}${d.conn === 'ok' ? '' : ' [' + d.conn + ']'}`)),
    h(Box, { ref: d.listRef, flexDirection: 'column' }, ...treeRows));
}
