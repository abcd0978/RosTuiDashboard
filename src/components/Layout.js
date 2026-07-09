// 최상위 구성 — 파일 컴포넌트(TreePanel) + 데이터 컴포넌트(ValuePanel) 를 나란히 렌더하고,
// 아래에 상태/오버레이 슬롯과 풋터를 둔다. 토픽 연결 전엔 Loading.
import { h } from '../react.js';
import { Box } from 'ink';
import { useDashboard } from '../store.js';
import { MIN_COLS, MIN_ROWS } from '../lib/util.js';
import { TreePanel } from './TreePanel.js';
import { ValuePanel } from './ValuePanel.js';
import { Overlay } from './Overlay.js';
import { EnvBar } from './EnvBar.js';
import { Footer } from './Footer.js';
import { Loading } from './Loading.js';
import { TooSmall } from './TooSmall.js';

export function Layout() {
  const { topics, cols, rows } = useDashboard();
  if (cols < MIN_COLS || rows < MIN_ROWS) return h(TooSmall);   // 너무 작으면 안내(리사이즈 시 자동 복귀)
  if (!topics) return h(Loading);
  return h(Box, { flexDirection: 'column', width: cols },
    h(Box, { flexDirection: 'row' }, h(TreePanel), h(ValuePanel)),
    h(Overlay),
    h(EnvBar),
    h(Footer));
}
