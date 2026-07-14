// 파라미터 값 입력줄(ROS1 set param) — edit 모드에서만 마운트. 키 입력 자기 책임.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { typable } from '../../../../shared/util.js';

const LABELS = {
  service: ['call', 'req', 'Enter=호출 Esc=취소  (YAML 요청, 예: {data: true})'],
  topic: ['pub', 'msg', 'Enter=발행(1회) Esc=취소  (YAML 메시지)'],
  action: ['goal', 'goal', 'Enter=goal 전송 Esc=취소  (YAML, 피드백은 J)'],
  param: ['set', '=', 'Enter=적용 Esc=취소'],
};

export function ParamEdit() {
  const d = useDashboard();
  const [verb, field, hint] = LABELS[d.edit.kind] || LABELS.param;
  // 입력창은 현재값/스켈레톤으로 미리 채워져 열린다(fresh=true). 텍스트 필드가 전체 선택된 상태처럼 굴어야 한다:
  //   첫 글자를 치면 → 기존 값을 "대체"(새 값을 넣으려는 것)
  //   백스페이스를 치면 → 기존 값을 "편집"(끝 글자만 지움)
  // 이게 없으면 프리필 값 뒤에 이어붙어 "1.0" + "2" = "1.02" 가 된다.
  useInput((ch, key) => {
    if (key.return) { d.submitEdit(d.edit.kind, d.edit.name, d.edit.value); d.setEdit(null); }
    else if (key.escape) d.setEdit(null);
    else if (key.backspace || key.delete) d.setEdit((e) => e && ({ ...e, value: e.value.slice(0, -1), fresh: false }));
    else if (typable(ch, key)) d.setEdit((e) => e && ({ ...e, value: (e.fresh ? '' : e.value) + ch, fresh: false }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, ` ${verb} ${d.edit.name}  ${field} `),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.edit.value} `),
    h(Text, { dimColor: true }, '  ' + hint));
}
