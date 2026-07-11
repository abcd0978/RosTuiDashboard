// 파라미터 값 입력줄(ROS1 set param) — edit 모드에서만 마운트. 키 입력 자기 책임.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { typable } from '../../lib/util.js';

const LABELS = {
  service: ['call', 'req', 'Enter=호출 Esc=취소  (YAML 요청, 예: {data: true})'],
  topic: ['pub', 'msg', 'Enter=발행(1회) Esc=취소  (YAML 메시지)'],
  action: ['goal', 'goal', 'Enter=goal 전송 Esc=취소  (YAML, 피드백은 J)'],
  param: ['set', '=', 'Enter=적용 Esc=취소'],
};

export function ParamEdit() {
  const d = useDashboard();
  const [verb, field, hint] = LABELS[d.edit.kind] || LABELS.param;
  useInput((ch, key) => {
    if (key.return) { d.submitEdit(d.edit.kind, d.edit.name, d.edit.value); d.setEdit(null); }
    else if (key.escape) d.setEdit(null);
    else if (key.backspace || key.delete) d.setEdit((e) => e && ({ ...e, value: e.value.slice(0, -1) }));
    else if (typable(ch, key)) d.setEdit((e) => e && ({ ...e, value: e.value + ch }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, ` ${verb} ${d.edit.name}  ${field} `),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.edit.value} `),
    h(Text, { dimColor: true }, '  ' + hint));
}
