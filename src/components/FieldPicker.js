// 📈 플롯 필드 선택 오버레이 — plotPick 모드에서만 마운트. ↑↓ 이동/Enter 열기/Esc 취소.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { clamp } from '../lib/util.js';

export function FieldPicker() {
  const d = useDashboard();
  const pick = d.plotPick;
  useInput((ch, key) => {
    if (key.return) { const f = pick.fields[pick.idx]; d.setPlotPick(null); d.launchPlot(f); }
    else if (key.escape || ch === 'q') d.setPlotPick(null);
    else if (key.downArrow || ch === 'j') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx + 1, 0, p.fields.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setPlotPick((p) => p && ({ ...p, idx: clamp(p.idx - 1, 0, p.fields.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const N = pick.fields.length, show = Math.min(10, N);
  const start = clamp(pick.idx - Math.floor(show / 2), 0, Math.max(0, N - show));
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'green', paddingX: 1 },
    h(Text, { color: 'green', bold: true }, ` 📈 plot 필드 선택 — ↑↓ 이동, Enter 열기, Esc 취소  (${N}개) `),
    ...Array.from({ length: show }, (_, i) => {
      const gi = start + i, f = pick.fields[gi], on = gi === pick.idx;
      return h(Text, { key: i, backgroundColor: on ? 'green' : undefined, color: on ? 'black' : undefined },
        ` ${on ? '▶' : ' '} ${f} `);
    }));
}
