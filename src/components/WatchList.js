// 👁 워치리스트 — 여러 토픽/필드를 핀 고정해 한 패널에서 동시에 라이브 값 표시.
//   ↑↓/클릭 이동 | a 추가(현재 토픽 필드) | d 삭제 | Esc 닫기.
import { h, useState } from '../react.js';
import { useInput } from 'ink';
import { useDashboard } from '../store.js';
import { useWatches } from '../hooks/useWatches.js';
import { clamp, pad } from '../lib/util.js';
import { OverlayFrame } from './common/OverlayFrame.js';
import { List } from './common/List.js';

export function WatchList() {
  const d = useDashboard();
  const list = d.watches;
  const vals = useWatches(list, d.ver);
  const [idx, setIdx] = useState(0);
  const cur = clamp(idx, 0, Math.max(0, list.length - 1));
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setWatchOpen(false);
    else if (ch === 'a') d.openFieldPicker('watch');     // 현재 토픽 필드 핀(오버레이 닫고 필드선택)
    else if (!list.length) return;
    else if (ch === 'd') { d.removeWatch(cur); setIdx((i) => clamp(i, 0, list.length - 2)); }
    else if (key.downArrow || ch === 'j') setIdx((i) => clamp(i + 1, 0, list.length - 1));
    else if (key.upArrow || ch === 'k') setIdx((i) => clamp(i - 1, 0, list.length - 1));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  return h(OverlayFrame, { color: 'magenta', title: `👁 Watch (${list.length})`, hint: 'a 추가(현재 토픽) · d 삭제 · Esc' },
    h(List, {
      items: list, idx: cur, visible: Math.max(3, (d.rows || 20) - 8), accent: 'magenta',
      onSelect: setIdx,
      renderRow: (wt) => {
        const v = vals[`${wt.topic}|${wt.field}`];
        return `${pad(`${wt.topic} · ${wt.field}`, w - 24)} = ${v == null ? '…' : v}`;
      },
      emptyText: ' (없음) 토픽 선택 후 a 로 필드 핀. 또는 값 패널에서 이 목록으로. ',
    }));
}
