// rosbag 재생 경로 입력 — bagPlay 모드에서만 마운트.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { typable } from '../../../../shared/util.js';

export function BagPlay() {
  const d = useDashboard();
  useInput((ch, key) => {
    if (key.return) { d.submitBagPlay(d.bagPlay.value); d.setBagPlay(null); }
    else if (key.escape) d.setBagPlay(null);
    else if (key.backspace || key.delete) d.setBagPlay((e) => e && ({ ...e, value: e.value.slice(0, -1) }));
    else if (typable(ch, key)) d.setBagPlay((e) => e && ({ ...e, value: e.value + ch }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, ' ▶ rosbag play  path = '),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.bagPlay.value} `),
    h(Text, { dimColor: true }, '  Enter=재생 Esc=취소'));
}
