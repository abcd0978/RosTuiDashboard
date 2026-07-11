// 🕸 노드 그래프 — 노드 간 통신 토폴로지(rqt_graph 의 터미널판). graphOpen 모드에서만 마운트.
//   ↑↓/PgUp/PgDn 스크롤 | a 전체↔선택노드 전환 | Esc 닫기.  라이브(텔레메트리 갱신마다 반영).
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp, pad } from '../../lib/util.js';
import { graphLines } from '../../lib/graph.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

export function GraphView() {
  const d = useDashboard();
  const g = d.graphOpen;
  const lines = graphLines(d.topics || [], g.focus);
  const H = Math.max(4, (d.rows || 20) - 7);
  const maxTop = Math.max(0, lines.length - H);
  const top = clamp(g.top || 0, 0, maxTop);
  useInput((ch, key) => {
    if (key.escape || ch === 'q' || ch === 'n') d.setGraphOpen(null);
    else if (ch === 'a') d.setGraphOpen((p) => p && ({ ...p, focus: p.focus ? null : d.graphFocusName, top: 0 }));
    else if (key.downArrow || ch === 'j') d.setGraphOpen((p) => p && ({ ...p, top: clamp(top + 1, 0, maxTop) }));
    else if (key.upArrow || ch === 'k') d.setGraphOpen((p) => p && ({ ...p, top: clamp(top - 1, 0, maxTop) }));
    else if (key.pageDown) d.setGraphOpen((p) => p && ({ ...p, top: clamp(top + H, 0, maxTop) }));
    else if (key.pageUp) d.setGraphOpen((p) => p && ({ ...p, top: clamp(top - H, 0, maxTop) }));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  const scope = g.focus ? `노드: ${g.focus}` : `전체 그래프 (${lines.length})`;
  const tag = maxTop > 0 ? `${top + 1}-${Math.min(lines.length, top + H)}/${lines.length} ↕` : '';
  return h(OverlayFrame, { color: 'cyan', title: `🕸 노드 그래프 — ${scope}`, hint: `${tag}  a 전체↔노드 · Esc` },
    ...Array.from({ length: Math.min(H, lines.length) }, (_, i) =>
      h(Text, { key: i, wrap: 'truncate-end' }, pad(' ' + (lines[top + i] ?? ''), w))));
}
