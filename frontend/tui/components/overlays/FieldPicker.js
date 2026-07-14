// 📈 플롯/워치 필드 선택 오버레이 — plotPick 모드에서만 마운트. 다중 선택 + 모드 선택.
//   ↑↓/클릭 이동 | space·더블클릭 선택/해제 | Enter time 플롯 | x XY/3D 플롯 | Esc 취소
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
  const chosen = (fallback) => (sel.size ? [...sel] : (fallback ? [fallback] : []));
  const isWatch = pick.target === 'watch';

  useInput((ch, key) => {
    const cur = pick.fields[pick.idx];
    if (key.escape || ch === 'q') d.setPlotPick(null);
    else if (ch === ' ') toggle(cur);
    else if (key.return) {
      const fs = chosen(cur);
      if (!fs.length) return;
      d.setPlotPick(null);
      if (isWatch) d.addWatch(d.active.name, fs); else d.launchPlot(fs, 'time');
    }
    else if (!isWatch && ch === 'x') {                     // 공간 플롯: 2개→XY, 3개→3D
      const fs = chosen();
      if (fs.length === 2) { d.setPlotPick(null); d.launchPlot(fs, 'xy'); }
      else if (fs.length === 3) { d.setPlotPick(null); d.launchPlot(fs, 'xyz'); }
      else d.setStatus('공간 플롯: 2개(XY) 또는 3개(3D) 선택 필요 (space)');
    }
    else if (key.downArrow || ch === 'j') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx + 1, 0, p.fields.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx - 1, 0, p.fields.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  return h(OverlayFrame, {
    color: 'green',
    title: isWatch ? `👁 watch 필드 (선택 ${sel.size})` : `📈 plot 필드 (선택 ${sel.size})`,
    hint: isWatch ? 'space 선택 · Enter 핀 · Esc' : 'space 선택 · Enter time · x 공간(2=XY·3=3D) · Esc',
  },
    h(List, {
      items: pick.fields, idx: pick.idx, visible: Math.max(3, (d.rows || 20) - 8), accent: 'green',
      onSelect: (i) => d.setPlotPick((p) => p && ({ ...p, idx: i })),
      onActivate: (i) => toggle(pick.fields[i]),
      renderRow: (f) => ({ text: `${sel.has(f) ? '[x]' : '[ ]'} ${f}`, color: sel.has(f) ? 'cyan' : undefined }),
    }));
}
