// 🧭 tf echo 프레임 입력 — 2단계(source → target). 확정 시 두 프레임 간 변환을 InfoView 로 표시.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { typable } from '../../lib/util.js';

export function TfEcho() {
  const d = useDashboard();
  const a = d.tfEcho;
  useInput((ch, key) => {
    if (key.escape) { d.setTfEcho(null); return; }
    if (key.return) {
      if (a.step === 'src') d.setTfEcho({ ...a, step: 'tgt' });
      else { d.setTfEcho(null); d.submitTfEcho(a.src, a.tgt); }
      return;
    }
    const field = a.step === 'src' ? 'src' : 'tgt';
    if (key.backspace || key.delete) d.setTfEcho((e) => e && ({ ...e, [field]: e[field].slice(0, -1) }));
    else if (typable(ch, key)) d.setTfEcho((e) => e && ({ ...e, [field]: e[field] + ch }));
  }, { isActive: !!process.stdin.isTTY });

  const cur = a.step === 'src' ? a.src : a.tgt;
  return h(Box, null,
    h(Text, { color: 'cyan' }, ` 🧭 tf echo — ${a.step === 'src' ? 'source frame' : `${a.src} → target frame`}: `),
    h(Text, { backgroundColor: 'cyan', color: 'black' }, `${cur} `),
    h(Text, { dimColor: true }, '  Enter=다음/실행 Esc=취소'));
}
