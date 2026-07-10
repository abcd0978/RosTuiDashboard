// 클릭 가능한 버튼(풋터).
// 깜빡임의 주범이던 hover(useOnMouseState)를 제거한다: hover 는 마우스가 움직일 때마다 'position'
// 이벤트로 setState → Ink 전체 프레임 재출력 → 심한 깜빡임을 유발했다(버튼 5개 = 모션당 5회 재렌더).
// 대신 'click' press 순간에만 버튼의 실시간 경계(yogaNode 레이아웃)를 읽어 좌표 히트테스트한다.
//  - 모션 재렌더 0 → 깜빡임 제거.
//  - press 시점의 최신 좌표 사용 → 레이아웃이 바뀌어도 어긋나지 않음(이전엔 마운트 시 좌표를 캐시해
//    '위치가 뒤틀림/클릭 안 됨' 문제가 있었다).
//  - 클릭 순간 짧게 하이라이트(120ms)로 피드백만 준다(모션이 아니라 클릭에만 재렌더).
import { h, useRef, useEffect, useState } from '../react.js';
import { Box, Text } from 'ink';
import { useMouse } from '@zenobius/ink-mouse';

// 요소의 화면상 절대 사각형(left,top,width,height)을 부모 yogaNode 를 거슬러 계산 — ink-mouse 내부와 동일.
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
  const [flash, setFlash] = useState(false);
  const st = useRef({});
  st.current = { onPress };
  useEffect(() => {
    if (!mouse || !mouse.events) return undefined;
    let t = null;
    const onClick = (pos, action) => {
      if (action !== 'press') return;
      const r = rectOf(ref.current);       // press 시점의 실시간 경계
      if (!r) return;
      if (pos.x < r.left || pos.x > r.left + r.width || pos.y < r.top || pos.y > r.top + r.height) return;
      setFlash(true);
      clearTimeout(t); t = setTimeout(() => setFlash(false), 120);
      st.current.onPress();
    };
    mouse.events.on('click', onClick);
    return () => { clearTimeout(t); mouse.events.off('click', onClick); };
  }, []);

  return h(Box, { ref, borderStyle: flash ? 'bold' : 'round', borderColor: flash ? color : 'gray', paddingX: 1, marginLeft: 1 },
    h(Text, { color: flash ? 'black' : color, backgroundColor: flash ? color : undefined, bold: flash }, ` ${label} `));
}
