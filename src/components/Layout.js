// 최상위 구성 — 파일 컴포넌트(TreePanel) + 데이터 컴포넌트(ValuePanel) 를 나란히 렌더하고,
// 아래에 상태/오버레이 슬롯과 풋터를 둔다. ROS 데이터 도착 전에도 대시보드를 바로 표시
// (트리 자리에 연결 상태 힌트만 표시). 화면이 너무 작을 때만 안내로 대체.
import { h } from '../react.js';
import { Box } from 'ink';
import { useDashboard } from '../store.js';
import { MIN_COLS, MIN_ROWS } from '../lib/util.js';
import { GlobalKeys } from './GlobalKeys.js';
import { TreePanel } from './TreePanel.js';
import { ValuePanel } from './ValuePanel.js';
import { Overlay } from './Overlay.js';
import { EnvBar } from './EnvBar.js';
import { Footer } from './Footer.js';
import { TooSmall } from './TooSmall.js';

export function Layout() {
  const { cols, rows, treeHidden } = useDashboard();
  if (cols < MIN_COLS || rows < MIN_ROWS) return h(TooSmall);   // 너무 작으면 안내(리사이즈 시 자동 복귀)
  return h(Box, { flexDirection: 'column', width: cols },
    h(GlobalKeys),                                              // 헤드리스 전역 키(트리 숨겨도 유지)
    h(Box, { flexDirection: 'row' },
      treeHidden ? null : h(TreePanel),
      h(ValuePanel)),
    h(Overlay),
    h(EnvBar),
    h(Footer));
}
