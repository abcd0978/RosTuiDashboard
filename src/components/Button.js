// 마우스 호버/클릭 반응 버튼(풋터의 Quit 등).
import { h, useRef } from '../react.js';
import { Box, Text } from 'ink';
import { useOnMouseState, useOnMouseClick } from '@zenobius/ink-mouse';

export function Button({ label, onPress, color = 'red' }) {
  const ref = useRef();
  const { hovering, clicking } = useOnMouseState(ref);
  useOnMouseClick(ref, (d) => { if (d) onPress(); });
  const a = hovering || clicking;
  return h(Box, { ref, borderStyle: a ? 'bold' : 'round', borderColor: a ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: a ? 'black' : 'gray', backgroundColor: a ? color : undefined, bold: a }, ` ${label} `));
}
