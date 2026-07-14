// 도움말 오버레이(?) — 긴 풋터 대신 단축키를 분류해 한눈에. Esc/?/q 로 닫기, 마우스로도.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';

const GROUPS = [
  ['탐색 · 보기', [['↑↓ / j k', '이동'], ['Enter / → / 클릭', '펼침 · 선택'], ['g / G', '맨위 · 맨아래'],
    ['/', '퍼지 검색'], ['Tab', '트리 숨김 ⇔ 값 전체폭'], ['휠', '트리/값 스크롤']]],
  ['값 · 플롯 · 조사', [['space', '값 프리즈'], ['[ ]', '값 스크롤'], ['+ -', '렌더율'],
    ['p', '플롯: 원값·n차 미분/적분·FFT·XY(회귀)·3D'], ['m', '메시지 정의(타입)'], ['Q', 'QoS 검사'], ['y', '이름 클립보드 복사']]],
  ['제어 (선택 종류별 x)', [['x on 토픽', 'publish(1회)'], ['x on 서비스', 'call(요청 인자)'],
    ['x on 노드', 'kill'], ['V on 노드', '라이프사이클(ROS2)'], ['x on 파라미터', 'set'], ['o on 노드', '파라미터 튜닝(ROS2)'], ['r', '노드 재시작'],
    ['. / X', '토픽 표시 / 스냅샷'], ['R / P / B', 'rosbag 녹화(표시 토픽) / 재생 / A·B 비교'], ['W', 'Teleop(Twist 조종, WASD)'], ['A', '🔴 트리거 녹화 무장(ERROR 시 자동 스냅샷)']]],
  ['도구 · 컨텍스트', [['c', '연결 뷰(pub/sub)'], ['n', '노드 그래프(토폴로지)'], ['t / T', 'TF 트리 / 두 프레임 echo'], ['S', '노드 리소스(CPU/RSS)'], ['w', '워치리스트'],
    ['b / 1-9', '북마크 — launch·스크립트·자주 쓰는 명령'],
    ['s (북마크창)', '프리셋 전환 — px4 ↔ turtlesim'],
    ['J', '작업(Jobs) 조회·종료'], ['L', '로그 뷰어(/rosout)'], ['h', 'Hz 측정 모드'], ['D', 'ROS_DOMAIN_ID']]],
  ['기타', [['H', '🩺 Doctor(그래프 자동 진단)'], ['K', '📌 Baseline/회귀(기준선 대비)'], ['O', '시스템 개요(ROS htop)'], ['v', '진단(/diagnostics)'], ['F', '프리플라이트 헬스체크(✓/✗)'], ['?', '이 도움말'], ['q', '종료']]],
];

function keyLine(k, desc) {
  return h(Box, { key: k },
    h(Text, { color: 'cyan' }, ('  ' + k).padEnd(20).slice(0, 20)),
    h(Text, null, desc));
}

export function Help() {
  const d = useDashboard();
  useInput((ch, key) => { if (key.escape || ch === '?' || ch === 'q') d.setHelp(false); }, { isActive: !!process.stdin.isTTY });
  const w = Math.max(40, (d.cols || 100) - 4);
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1, width: w + 2 },
    h(Text, { color: 'cyan', bold: true }, ' RDash 단축키  —  Esc/? 닫기 · 마우스 클릭도 지원'),
    ...GROUPS.flatMap(([title, rows]) => [
      h(Text, { key: title, color: 'yellow', bold: true }, ' ▍' + title),
      ...rows.map(([k, desc]) => keyLine(k, desc)),
    ]));
}
