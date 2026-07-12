// 🔀 A/B bag 비교 경로 입력 — 2단계(bag A → bag B). 확정 시 두 bag 의 info 를 나란히 표시.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { typable } from '../../lib/util.js';

export function BagCompare() {
  const d = useDashboard();
  const a = d.bagCmp;
  useInput((ch, key) => {
    if (key.escape) { d.setBagCmp(null); return; }
    if (key.return) {
      if (a.step === 'a') d.setBagCmp({ ...a, step: 'b' });
      else { d.setBagCmp(null); d.submitBagCompare(a.a, a.b); }
      return;
    }
    const field = a.step === 'a' ? 'a' : 'b';
    if (key.backspace || key.delete) d.setBagCmp((e) => e && ({ ...e, [field]: e[field].slice(0, -1) }));
    else if (typable(ch, key)) d.setBagCmp((e) => e && ({ ...e, [field]: e[field] + ch }));
  }, { isActive: !!process.stdin.isTTY });

  const cur = a.step === 'a' ? a.a : a.b;
  return h(Box, null,
    h(Text, { color: 'cyan' }, ` 🔀 bag 비교 — ${a.step === 'a' ? 'bag A' : `A=${a.a}   bag B`} path: `),
    h(Text, { backgroundColor: 'cyan', color: 'black' }, `${cur} `),
    h(Text, { dimColor: true }, '  Enter=다음/비교 Esc=취소'));
}
