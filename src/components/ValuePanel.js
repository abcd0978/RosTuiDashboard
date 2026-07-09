// 오른쪽 "데이터 컴포넌트" — 선택 항목의 실시간 값(토픽 echo / 정보). 세로 스크롤·프리즈·대역폭 표시.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { pad, clamp } from '../lib/util.js';
import { fieldValue } from '../lib/ros.js';

// header.stamp 가 있으면 지연(ms), 없으면 telemetry 수신 age(s) 를 색과 함께 반환.
function ageTag(active, echo, activeAge) {
  if (!active || active.kind !== 'topic') return null;
  const sec = Number(fieldValue(echo, 'header.stamp.sec'));
  const nsec = Number(fieldValue(echo, 'header.stamp.nanosec'));
  if (Number.isFinite(sec) && sec > 0) {
    const ms = Math.round((Date.now() / 1000 - (sec + (nsec || 0) / 1e9)) * 1000);
    // 벽시계 스탬프일 때만 지연 표시. |ms|이 비상식적이면(sim time 등) age 로 폴백.
    if (Math.abs(ms) < 60000) return { text: `lat ${ms}ms`, color: ms < 100 ? 'green' : ms < 500 ? 'yellow' : 'red' };
  }
  if (activeAge != null) return { text: `age ${activeAge}s`, color: activeAge < 1 ? 'green' : activeAge < 3 ? 'yellow' : 'red' };
  return null;
}

export function ValuePanel() {
  const { active, echo, VISIBLE, RW, rightW, valTop, valMaxRef, activeHz, activeAge, bw, frozen } = useDashboard();
  const age = ageTag(active, echo, activeAge);

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

  const rightLen = scrollTag.length + (age ? age.text.length + 2 : 0);
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: rightW, paddingX: 1, marginLeft: 1 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'green' }, titleTxt.slice(0, Math.max(0, RW - rightLen - 1))),
      h(Box, null,
        age ? h(Text, { color: age.color }, ` ${age.text} `) : null,
        h(Text, { color: 'yellow' }, scrollTag))),
    ...valLines.map((l, i) => h(Text, { key: i, color: active ? undefined : 'gray' }, l)));
}
