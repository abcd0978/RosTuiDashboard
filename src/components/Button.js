// 클릭 가능한 버튼(풋터). [진단용] hover 효과 ON — ink-mouse 가 계산한 히트박스 위에 마우스가
// 오면 반전 하이라이트되어, 시각적 버튼 위치와 얼마나 어긋나는지 눈으로 확인할 수 있다.
// (hover 는 마우스 모션마다 재렌더 → 약간의 깜빡임. 위치 문제 해결 후 정리 예정.)
import { h, useRef } from '../react.js';
import { Box, Text } from 'ink';
import { useOnMouseState, useOnMouseClick } from '@zenobius/ink-mouse';

export function Button({ label, onPress, color = 'gray' }) {
  const ref = useRef();
  const { hovering, clicking } = useOnMouseState(ref);
  useOnMouseClick(ref, (d) => { if (d) onPress(); });
  const a = hovering || clicking;
  return h(Box, { ref, borderStyle: a ? 'bold' : 'round', borderColor: a ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: a ? 'black' : color, backgroundColor: a ? color : undefined, bold: a }, ` ${label} `));
}
