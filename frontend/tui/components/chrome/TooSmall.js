// 터미널이 최소 크기보다 작을 때 안내 — 창을 키우면(리사이즈) 자동으로 대시보드로 복귀.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { MIN_COLS, MIN_ROWS } from '../../../../shared/util.js';

export function TooSmall() {
  const { cols, rows, quit } = useDashboard();
  useInput((ch) => { if (ch === 'q') quit(); }, { isActive: !!process.stdin.isTTY });
  const wOk = cols >= MIN_COLS;
  const hOk = rows >= MIN_ROWS;
  return h(Box, { flexDirection: 'column' },
    h(Text, { color: 'yellow', bold: true }, ' RDash: 터미널이 작습니다'),
    h(Text, null, ` now  ${cols}x${rows}`),
    h(Text, null, h(Text, { color: wOk ? 'green' : 'red' }, ` need cols>=${MIN_COLS}`),
      '  ', h(Text, { color: hOk ? 'green' : 'red' }, `rows>=${MIN_ROWS}`)),
    h(Text, { dimColor: true }, ' 창을 키우세요 · q 종료'));
}
