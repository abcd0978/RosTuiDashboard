// 🩺 진단 (/diagnostics) — 컴포넌트별 상태(OK/WARN/ERROR/STALE) 집계. diagOpen 모드에서만.
//   ↑↓ 스크롤 | Esc 닫기.  나쁜 순(ERROR>WARN>...)으로 정렬.
import { h, useState } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { useDiagnostics } from '../../hooks/useDiagnostics.js';
import { clamp, pad } from '../../lib/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

const LV = ['OK', 'WARN', 'ERROR', 'STALE'];
const LCOL = ['green', 'yellow', 'red', 'gray'];

export function DiagnosticsView() {
  const d = useDashboard();
  const map = useDiagnostics(true, d.ver);
  const rows = Object.entries(map)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => (b.level === 3 ? 1.5 : b.level) - (a.level === 3 ? 1.5 : a.level) || a.name.localeCompare(b.name));
  const counts = [0, 0, 0, 0];
  for (const r of rows) counts[r.level] = (counts[r.level] || 0) + 1;

  const H = Math.max(4, (d.rows || 20) - 6);
  const maxTop = Math.max(0, rows.length - H);
  const [top, setTop] = useState(0);
  const dtop = clamp(top, 0, maxTop);
  useInput((ch, key) => {
    if (key.escape || ch === 'q' || ch === 'v') d.setDiagOpen(null);
    else if (key.downArrow || ch === 'j') setTop((v) => clamp(v + 1, 0, maxTop));
    else if (key.upArrow || ch === 'k') setTop((v) => clamp(v - 1, 0, maxTop));
    else if (key.pageDown) setTop((v) => clamp(v + H, 0, maxTop));
    else if (key.pageUp) setTop((v) => clamp(v - H, 0, maxTop));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  const summary = `OK ${counts[0]} · WARN ${counts[1]} · ERROR ${counts[2]} · STALE ${counts[3] || 0}`;
  return h(OverlayFrame, { color: counts[2] ? 'red' : counts[1] ? 'yellow' : 'green', title: `🩺 진단 (/diagnostics) — ${summary}`, hint: `${maxTop > 0 ? `${dtop + 1}/${rows.length} ↕  ` : ''}Esc` },
    ...(rows.length
      ? Array.from({ length: Math.min(H, rows.length) }, (_, i) => {
          const r = rows[dtop + i]; if (!r) return h(Text, { key: i }, ' ');
          return h(Text, { key: i, color: LCOL[r.level] || undefined, wrap: 'truncate-end' },
            pad(` ${pad(LV[r.level] || '?', 5)} ${pad(r.name, 40)} ${r.message}`, w));
        })
      : [h(Text, { key: 'e', dimColor: true }, ' (/diagnostics 수신 대기… 발행 노드가 없을 수 있음) ')]));
}
