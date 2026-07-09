// 📈 플롯 필드 선택 오버레이 — plotPick 모드에서만 마운트. 다중 선택 + 모드 선택을 자기 책임에서 처리.
//   ↑↓ 이동 | space 선택/해제(다중) | Enter time 플롯 | x XY 플롯(2개 선택) | Esc 취소
import { h, useState } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { clamp } from '../lib/util.js';

export function FieldPicker() {
  const d = useDashboard();
  const pick = d.plotPick;
  const [sel, setSel] = useState(() => new Set());   // 선택된 필드 경로들(다중)

  const toggle = (f) => setSel((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const chosen = (fallback) => (sel.size ? [...sel] : (fallback ? [fallback] : []));

  useInput((ch, key) => {
    const cur = pick.fields[pick.idx];
    if (key.escape || ch === 'q') { d.setPlotPick(null); }
    else if (ch === ' ') toggle(cur);
    else if (ch === 'x') {                                 // 공간 플롯: 2개→XY, 3개→3D
      const fs = chosen();
      if (fs.length === 2) { d.setPlotPick(null); d.launchPlot(fs, 'xy'); }
      else if (fs.length === 3) { d.setPlotPick(null); d.launchPlot(fs, 'xyz'); }
      else d.setStatus('공간 플롯: 2개(XY) 또는 3개(3D) 선택 필요 (space)');
    }
    else if (key.return) { const fs = chosen(cur); if (fs.length) { d.setPlotPick(null); d.launchPlot(fs, 'time'); } }
    else if (key.downArrow || ch === 'j') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx + 1, 0, p.fields.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx - 1, 0, p.fields.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const N = pick.fields.length, show = Math.min(10, N);
  const start = clamp(pick.idx - Math.floor(show / 2), 0, Math.max(0, N - show));
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'green', paddingX: 1 },
    h(Text, { color: 'green', bold: true },
      ` 📈 plot 필드 — space 선택(${sel.size}) | Enter time | x 공간(2=XY·3=3D) | Esc 취소 `),
    ...Array.from({ length: show }, (_, i) => {
      const gi = start + i, f = pick.fields[gi], on = gi === pick.idx, checked = sel.has(f);
      return h(Text, { key: i, backgroundColor: on ? 'green' : undefined, color: on ? 'black' : (checked ? 'cyan' : undefined) },
        ` ${on ? '▶' : ' '} ${checked ? '[x]' : '[ ]'} ${f} `);
    }));
}
