// 클릭 가능한 버튼(풋터). hover 상태는 쓰지 않는다 — 마우스 모션마다 재렌더되어 느린 터미널에서
// 깜빡이기 때문. 클릭만 처리하고 스타일은 정적(색으로 구분).
import { h, useRef } from '../react.js';
import { Box, Text } from 'ink';
import { useOnMouseClick } from '@zenobius/ink-mouse';

export function Button({ label, onPress, color = 'gray' }) {
  const ref = useRef();
  useOnMouseClick(ref, (d) => { if (d) onPress(); });
  return h(Box, { ref, borderStyle: 'round', borderColor: color, paddingX: 1, marginLeft: 1 },
    h(Text, { color }, ` ${label} `));
}
