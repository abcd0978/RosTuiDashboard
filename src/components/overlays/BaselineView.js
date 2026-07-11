// 📌 Baseline/회귀 — 저장한 "정상" 프로파일과 라이브를 diff. baselineOpen 모드에서만.
//   b=현재를 기준선으로 저장 · Enter=해당 대상으로 점프 · Esc 닫기. 노드 누락·Hz 저하·토픽 증발을 자동 감지.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp } from '../../lib/util.js';
import { diffBaseline } from '../../lib/baseline.js';
import { SEV } from '../../lib/doctor.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

const COLOR = ['red', 'yellow', 'gray'];
const MARK = ['●', '▲', 'ℹ'];

export function BaselineView() {
  const d = useDashboard();
  const rows = diffBaseline(d.baseline, d.allItems || []);
  const idx = clamp(d.baselineOpen.idx || 0, 0, Math.max(0, rows.length - 1));
  const jump = (i) => {
    const r = rows[i]; d.setBaselineOpen(null);
    const it = (d.allItems || []).find((x) => x.name === r?.target);
    if (it) { d.setActive(it); d.setStatus(`📌 ${r.target}: ${r.msg}`); }
  };
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setBaselineOpen(null);
    else if (ch === 'b') d.saveBaselineNow();
    else if (key.return) jump(idx);
    else if (key.downArrow || ch === 'j') d.setBaselineOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, rows.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setBaselineOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, rows.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const when = d.baseline && d.baseline.at ? new Date(d.baseline.at).toLocaleString() : null;
  const head = d.baseline
    ? `기준선: 노드 ${(d.baseline.nodes || []).length} · 토픽 ${Object.keys(d.baseline.topics || {}).length}${when ? ' · ' + when : ''}`
    : '저장된 기준선 없음';

  if (!d.baseline) {
    return h(OverlayFrame, { color: 'yellow', title: '📌 Baseline / 회귀', hint: 'b=현재를 기준선으로 저장 · Esc' },
      h(Box, { marginTop: 1 }, h(Text, { color: 'yellow' }, 'b 를 눌러 지금 상태를 "정상 기준선"으로 저장하세요. 이후 열면 라이브와 diff 합니다.')));
  }
  return h(OverlayFrame, { color: rows.some((r) => r.sev === 0) ? 'red' : rows.length ? 'yellow' : 'green', title: '📌 Baseline / 회귀', hint: 'b=재저장 · Enter=점프 · Esc' },
    h(Box, { marginBottom: 1 }, h(Text, { dimColor: true }, head)),
    rows.length
      ? h(List, {
        items: rows, idx, visible: Math.min(rows.length, (d.rows || 24) - 8), accent: rows.some((r) => r.sev === 0) ? 'red' : 'yellow',
        onSelect: (i) => d.setBaselineOpen((p) => p && ({ ...p, idx: i })),
        onActivate: jump,
        renderRow: (r) => ({ text: `${MARK[r.sev]} ${SEV[r.sev].padEnd(5)} ${r.target}  —  ${r.msg}`, color: COLOR[r.sev] }),
      })
      : h(Box, null, h(Text, { color: 'green' }, '✓ 기준선과 동일 — 회귀 없음')));
}
