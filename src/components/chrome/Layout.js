// 최상위 구성 — 파일 컴포넌트(TreePanel) + 데이터 컴포넌트(ValuePanel) 를 나란히 렌더하고,
// 아래에 상태/오버레이 슬롯과 풋터를 둔다. ROS 데이터 도착 전에도 대시보드를 바로 표시
// (트리 자리에 연결 상태 힌트만 표시). 화면이 너무 작을 때만 안내로 대체.
import { h } from '../../react.js';
import { Box } from 'ink';
import { useDashboard } from '../../store.js';
import { MIN_COLS, MIN_ROWS } from '../../lib/util.js';
import { GlobalKeys } from './GlobalKeys.js';
import { TreePanel } from '../panels/TreePanel.js';
import { ValuePanel } from '../panels/ValuePanel.js';
import { Overlay } from '../overlays/Overlay.js';
import { EnvBar } from './EnvBar.js';
import { Footer } from './Footer.js';
import { TooSmall } from './TooSmall.js';

// 큰(모달) 오버레이 — 트리 대신 전체 영역을 차지한다(Jobs·Help·발행 폼 등). 작은 입력줄(검색·값 편집)은
// 트리를 보면서 아래에 인라인으로 뜬다.
const isModal = (d) => !!(d.help || d.preflightOpen || d.watchOpen || d.pubForm || d.jobsOpen
  || d.bmOpen || d.bmAdd || d.infoView || d.plotPick || d.graphOpen || d.qosOpen || d.logOpen || d.paramPanel || d.overviewOpen || d.diagOpen || d.lifeOpen || d.teleopOpen);

export function Layout() {
  const d = useDashboard();
  const { cols, rows, treeHidden } = d;
  if (cols < MIN_COLS || rows < MIN_ROWS) return h(TooSmall);   // 너무 작으면 안내(리사이즈 시 자동 복귀)
  const modal = isModal(d);
  // 전체 높이를 rows-1 로 고정 + overflow 숨김. Ink 5 는 프레임 높이가 터미널 rows 이상이면 매 프레임
  // 화면 전체를 지우고(clearTerminal) 다시 그려 심하게 깜빡인다. 높이를 rows-1 로 묶으면 그 분기에 절대
  // 안 들어가 깜빡임이 사라진다. MAIN 영역(flexGrow)이 EnvBar·Footer 위 공간을 꽉 채우고, 넘치는 내용은
  // 잘린다 → Footer 는 항상 바닥에 온전히 보인다.
  return h(Box, { flexDirection: 'column', width: cols, height: rows - 1, overflow: 'hidden' },
    h(GlobalKeys),                                              // 헤드리스 전역 키(트리 숨겨도 유지)
    h(Box, { flexGrow: 1, flexShrink: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' },
      modal
        ? h(Overlay)                                           // 모달: 패널 대신 오버레이가 영역 차지
        : h(Box, { flexDirection: 'row' },                     // 평소: 트리 + 값 패널
          treeHidden ? null : h(TreePanel),
          h(ValuePanel))),
    modal ? null : h(Overlay),                                 // 인라인 오버레이(검색/편집/상태줄)
    h(Box, { flexShrink: 0, flexDirection: 'column' },
      h(EnvBar),
      h(Footer)));
}
