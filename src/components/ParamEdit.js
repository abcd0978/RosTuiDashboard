// 파라미터 값 입력줄(ROS1 set param) — edit 모드에서만 마운트. 키 입력 자기 책임.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';

export function ParamEdit() {
  const d = useDashboard();
  const isSvc = d.edit.kind === 'service';
  useInput((ch, key) => {
    if (key.return) { d.submitEdit(d.edit.kind, d.edit.name, d.edit.value); d.setEdit(null); }
    else if (key.escape) d.setEdit(null);
    else if (key.backspace || key.delete) d.setEdit((e) => e && ({ ...e, value: e.value.slice(0, -1) }));
    else if (ch && !key.ctrl && !key.meta) d.setEdit((e) => e && ({ ...e, value: e.value + ch }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, isSvc ? ` call ${d.edit.name}  req = ` : ` set ${d.edit.name} = `),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.edit.value} `),
    h(Text, { dimColor: true }, isSvc ? '  Enter=호출 Esc=취소  (YAML 요청, 예: {name: box, ...})' : '  Enter=적용 Esc=취소'));
}
