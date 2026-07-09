// 오른쪽 "데이터 컴포넌트" — 선택 항목의 실시간 값(토픽 echo / 정보). 세로 스크롤·프리즈·대역폭 표시.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { pad, clamp } from '../lib/util.js';

export function ValuePanel() {
  const { active, echo, VISIBLE, RW, rightW, valTop, valMaxRef, activeHz, bw, frozen } = useDashboard();

  const raw = active ? echo : '  <- select a topic on the left (Enter / click)\n  expand a folder ( > ) to see its topics';
  const rawLines = raw.split('\n');
  const valMax = Math.max(0, rawLines.length - VISIBLE);
  valMaxRef.current = valMax;
  const dvalTop = clamp(valTop, 0, valMax);
  const valLines = Array.from({ length: VISIBLE }, (_, i) => pad(rawLines[dvalTop + i] ?? '', RW));
  const scrollTag = valMax > 0 ? `${dvalTop + 1}-${Math.min(rawLines.length, dvalTop + VISIBLE)}/${rawLines.length} ↕` : '';
  const titleTxt = active
    ? `${active.name} [${active.kind}]${active.kind === 'topic'
        ? ` ${activeHz != null ? activeHz : '?'}Hz${bw ? ` · ${bw}` : ''}${frozen ? ' ❄' : ''}` : ''}`
    : '(선택 없음)';

  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: rightW, paddingX: 1, marginLeft: 1 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'green' }, titleTxt.slice(0, Math.max(0, RW - scrollTag.length - 1))),
      h(Text, { color: 'yellow' }, scrollTag)),
    ...valLines.map((l, i) => h(Text, { key: i, color: active ? undefined : 'gray' }, l)));
}
