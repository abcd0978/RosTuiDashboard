// 북마크 추가 입력 — 2단계(이름 → 명령). bmAdd 모드에서만 마운트.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { typable, clamp } from '../lib/util.js';
import { BOOKMARK_TEMPLATES } from '../lib/bookmarks.js';

export function BookmarkAdd() {
  const d = useDashboard();
  const a = d.bmAdd;
  const onCmd = a.step === 'cmd';
  useInput((ch, key) => {
    if (key.escape) { d.setBmAdd(null); return; }
    if (key.return) {
      if (a.step === 'name') d.setBmAdd({ ...a, step: 'cmd' });
      else { d.addBookmark(a.name.trim(), a.cmd.trim()); d.setBmAdd(null); }
      return;
    }
    // cmd 단계에서 ↑↓ = 템플릿 넘기기(명령 안 외워도 됨)
    if (onCmd && (key.upArrow || key.downArrow)) {
      const ti = clamp((a.ti ?? -1) + (key.downArrow ? 1 : -1), 0, BOOKMARK_TEMPLATES.length - 1);
      d.setBmAdd((e) => e && ({ ...e, ti, cmd: BOOKMARK_TEMPLATES[ti] }));
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
      h(Text, { dimColor: true }, onCmd ? '  Enter=저장 ↑↓=템플릿 Esc=취소' : '  Enter=다음 Esc=취소')));
}
