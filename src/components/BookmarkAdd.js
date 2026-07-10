// 북마크 추가 입력 — 2단계(이름 → 명령). bmAdd 모드에서만 마운트.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { typable } from '../lib/util.js';

export function BookmarkAdd() {
  const d = useDashboard();
  const a = d.bmAdd;
  useInput((ch, key) => {
    if (key.escape) { d.setBmAdd(null); return; }
    if (key.return) {
      if (a.step === 'name') d.setBmAdd({ ...a, step: 'cmd' });
      else { d.addBookmark(a.name.trim(), a.cmd.trim()); d.setBmAdd(null); }
      return;
    }
    const field = a.step;   // 'name' | 'cmd'
    if (key.backspace || key.delete) d.setBmAdd((e) => e && ({ ...e, [field]: e[field].slice(0, -1) }));
    else if (typable(ch, key)) d.setBmAdd((e) => e && ({ ...e, [field]: e[field] + ch }));
  }, { isActive: !!process.stdin.isTTY });

  const cur = a.step === 'name' ? a.name : a.cmd;
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1 },
    h(Text, { color: 'magenta', bold: true }, ` ★ 북마크 추가 — ${a.step === 'name' ? '이름' : '명령(셸)'} 입력 `),
    h(Box, null,
      h(Text, { dimColor: true }, a.step === 'name' ? ' name: ' : ` name: ${a.name}   cmd: `),
      h(Text, { backgroundColor: 'magenta', color: 'black' }, `${cur} `),
      h(Text, { dimColor: true }, '  Enter=다음/저장 Esc=취소')));
}
