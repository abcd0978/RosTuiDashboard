// 공통 오버레이 틀 — 둥근 테두리 + 제목/힌트 헤더. 리스트형 오버레이들의 반복 boilerplate 를 없앤다.
import { h } from '../../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../../store.js';

export function OverlayFrame({ color = 'cyan', title, hint, width, children }) {
  const d = useDashboard();
  const w = width ?? Math.max(30, (d.cols || 100) - 4);
  const kids = Array.isArray(children) ? children : [children];
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1, width: w + 2 },
    h(Box, { justifyContent: hint ? 'space-between' : undefined },
      h(Text, { color, bold: true }, ` ${title} `),
      hint ? h(Text, { dimColor: true }, `${hint} `) : null),
    ...kids);
}
