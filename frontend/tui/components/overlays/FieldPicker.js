// 👁 워치 필드 선택 오버레이 — plotPick 모드에서만 마운트. 다중 선택.
//   ↑↓/클릭 이동 | space·더블클릭 선택/해제 | Enter 핀 | Esc 취소
// 플롯은 TUI 에서 제거됐다 — 시계열/FFT/XY 는 웹 PlotLab 으로 일원화.
import { h, useState } from '../../react.js';
import { useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

export function FieldPicker() {
  const d = useDashboard();
  const pick = d.plotPick;
  const [sel, setSel] = useState(() => new Set());   // 선택된 필드 경로들(다중)
  const toggle = (f) => setSel((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });

  useInput((ch, key) => {
    const cur = pick.fields[pick.idx];
    if (key.escape || ch === 'q') d.setPlotPick(null);
    else if (ch === ' ') toggle(cur);
    else if (key.return) {
      const fs = sel.size ? [...sel] : (cur ? [cur] : []);
      if (!fs.length) return;
      d.setPlotPick(null);
      d.addWatch(d.active.name, fs);
    }
    else if (key.downArrow || ch === 'j') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx + 1, 0, p.fields.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx - 1, 0, p.fields.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  return h(OverlayFrame, {
    color: 'green',
    title: `👁 watch 필드 (선택 ${sel.size})`,
    hint: 'space 선택 · Enter 핀 · Esc',
  },
    h(List, {
      items: pick.fields, idx: pick.idx, visible: Math.max(3, (d.rows || 20) - 8), accent: 'green',
      onSelect: (i) => d.setPlotPick((p) => p && ({ ...p, idx: i })),
      onActivate: (i) => toggle(pick.fields[i]),
      renderRow: (f) => ({ text: `${sel.has(f) ? '[x]' : '[ ]'} ${f}`, color: sel.has(f) ? 'cyan' : undefined }),
    }));
}
