// 클릭 가능한 버튼(풋터). 호버하면 배경색이 채워지고, 클릭(press)하면 실행된다.
//  · 호버: useOnMouseHover 로 이 버튼에 마우스가 얹혔을 때만 setState → 그 버튼만 리렌더(모션마다 X).
//  · 클릭: press 시점에 버튼의 실시간 yoga 경계를 읽어 좌표 히트테스트(레이아웃 바뀌어도 안 어긋남).
//  깜빡임은 라인 diff 출력기가 바뀐 줄만 다시 그려 없앤다.
import { h, useRef, useEffect, useState } from '../../react.js';
import { Box, Text } from 'ink';
import { useMouse, useOnMouseHover } from '@zenobius/ink-mouse';

// 요소의 화면상 절대 사각형(left,top,width,height)을 부모 yogaNode 를 거슬러 계산.
function rectOf(node) {
  if (!node || !node.yogaNode) return null;
  const l = node.yogaNode.getComputedLayout();
  let x = 0, y = 0, p = node.parentNode;
  while (p && p.yogaNode) { const pl = p.yogaNode.getComputedLayout(); x += pl.left; y += pl.top; p = p.parentNode; }
  return { left: l.left + x, top: l.top + y, width: l.width, height: l.height };
}

export function Button({ label, onPress, color = 'gray' }) {
  const ref = useRef();
  const mouse = useMouse();
  const [hovering, setHovering] = useState(false);
  useOnMouseHover(ref, setHovering);            // 호버 상태(바뀔 때만 리렌더)
  const st = useRef({});
  st.current = { onPress };
  useEffect(() => {
    if (!mouse || !mouse.events) return undefined;
    const onClick = (pos, action) => {
      if (action !== 'press') return;
      const r = rectOf(ref.current);
      if (!r) return;
      if (pos.x < r.left || pos.x > r.left + r.width || pos.y < r.top || pos.y > r.top + r.height) return;
      st.current.onPress();
    };
    mouse.events.on('click', onClick);
    return () => mouse.events.off('click', onClick);
  }, []);

  const a = hovering;
  return h(Box, { ref, borderStyle: a ? 'bold' : 'round', borderColor: a ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: a ? 'black' : color, backgroundColor: a ? color : undefined, bold: a }, ` ${label} `));
}
