// 클릭 가능한 버튼(풋터). ink-mouse 의 useOnMouseClick(press+release 매칭)은 이 환경에서 클릭을
// 자주 놓쳐서, 대신 "hover 된 상태에서 press 이벤트"로 실행한다 — hover 위치는 정확하고(아래 하이라이트로
// 확인됨) press 이벤트는 신뢰성 있으므로 클릭이 안정적으로 잡힌다.
import { h, useRef, useEffect } from '../react.js';
import { Box, Text } from 'ink';
import { useOnMouseState, useMouse } from '@zenobius/ink-mouse';

export function Button({ label, onPress, color = 'gray' }) {
  const ref = useRef();
  const { hovering, clicking } = useOnMouseState(ref);
  const mouse = useMouse();
  const st = useRef({});
  st.current = { hovering, onPress };
  useEffect(() => {
    if (!mouse || !mouse.events) return undefined;
    const onClick = (_pos, action) => { if (action === 'press' && st.current.hovering) st.current.onPress(); };
    mouse.events.on('click', onClick);
    return () => mouse.events.off('click', onClick);
  }, []);

  const a = hovering || clicking;
  return h(Box, { ref, borderStyle: a ? 'bold' : 'round', borderColor: a ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: a ? 'black' : color, backgroundColor: a ? color : undefined, bold: a }, ` ${label} `));
}
