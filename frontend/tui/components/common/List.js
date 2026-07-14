// 공통 선택 리스트 — 리스트형 오버레이(북마크·Jobs·워치·필드선택…)가 모두 재사용한다.
//   · 스크롤 창(선택 항목 따라 자동 이동) + "n-m/total" 표시
//   · 선택 하이라이트(accent 배경) + 마우스 호버 하이라이트(파란 배경, 바뀔 때만 리렌더)
//   · 클릭 = 선택(onSelect) · 더블클릭 = 실행(onActivate)
// 키보드(↑↓/Enter/기타)는 각 오버레이가 자기 useInput 으로 처리하고, 여기선 렌더+마우스만 담당한다.
import { h, useRef, useState, useEffect } from '../../react.js';
import { Box, Text } from 'ink';
import { useMouse, useElementPosition } from '@zenobius/ink-mouse';
import { clamp } from '../../../../shared/util.js';

// renderRow(item, i, {selected, hovered}) → 문자열 또는 {text, color, dim, bold}
export function List({ items, idx, onSelect, onActivate, renderRow, visible = 10, accent = 'cyan', emptyText }) {
  const ref = useRef();
  const n = items.length;
  const cur = clamp(idx || 0, 0, Math.max(0, n - 1));
  const top = clamp(cur - visible + 1 <= 0 ? 0 : cur - visible + 1, 0, Math.max(0, n - visible));
  const pos = useElementPosition(ref, [n, top]);
  const mouse = useMouse();
  const [hover, setHover] = useState(-1);

  const R = useRef({}); R.current = { top, visible, n, pos, onSelect, onActivate };
  const clickRef = useRef({ t: 0, i: -1 });
  useEffect(() => {
    if (!mouse || !mouse.events) return undefined;
    const rowAt = (p) => {
      if (!p) return -1;
      const slot = p.y - (R.current.pos.top || 0) - 1;   // 마우스 y 는 1-based → -1
      if (slot < 0 || slot >= R.current.visible) return -1;
      const i = R.current.top + slot;
      return i < R.current.n ? i : -1;
    };
    const onMove = (p) => { const i = rowAt(p); setHover((c) => (c === i ? c : i)); };
    let down = false;
    const onClick = (p, action) => {
      if (action === 'release') { down = false; return; }
      if (action !== 'press' || down) return;
      down = true;
      const i = rowAt(p);
      if (i < 0) return;
      if (R.current.onSelect) R.current.onSelect(i);
      const now = Date.now(), cr = clickRef.current;   // 더블클릭 = 같은 행 450ms 내 두 번
      if (cr.i === i && now - cr.t < 450) { if (R.current.onActivate) R.current.onActivate(i); clickRef.current = { t: 0, i: -1 }; }
      else clickRef.current = { t: now, i };
    };
    mouse.events.on('position', onMove);
    mouse.events.on('click', onClick);
    return () => { mouse.events.off('position', onMove); mouse.events.off('click', onClick); };
  }, []);

  if (!n) return h(Box, null, h(Text, { dimColor: true }, emptyText || ' (없음) '));
  const rows = [];
  for (let s = 0; s < visible && top + s < n; s++) {
    const i = top + s;
    const selected = i === cur, hovered = !selected && i === hover;
    let r = renderRow(items[i], i, { selected, hovered });
    if (typeof r === 'string') r = { text: r };
    rows.push(h(Text, {
      key: i,
      wrap: 'truncate-end',
      backgroundColor: selected ? accent : hovered ? 'blue' : undefined,
      color: selected ? 'black' : hovered ? 'white' : r.color,
      bold: selected || r.bold,
      dimColor: !selected && !hovered && r.dim,
    }, ` ${selected ? '▶' : hovered ? '·' : ' '} ${r.text} `));
  }
  const more = n > visible ? h(Text, { key: 'more', dimColor: true }, `   ${top > 0 ? '▲' : ''}${top + 1}-${top + rows.length}/${n}${top + visible < n ? '▼' : ''}`) : null;
  return h(Box, { ref, flexDirection: 'column' }, ...rows, more);
}
