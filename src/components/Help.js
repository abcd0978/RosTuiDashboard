// 도움말 오버레이(?) — 긴 풋터 대신 단축키를 분류해 한눈에. Esc/?/q 로 닫기, 마우스로도.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';

const GROUPS = [
  ['탐색 · 보기', [['↑↓ / j k', '이동'], ['Enter / → / 클릭', '펼침 · 선택'], ['g / G', '맨위 · 맨아래'],
    ['/', '퍼지 검색'], ['Tab', '트리 숨김 ⇔ 값 전체폭'], ['휠', '트리/값 스크롤']]],
  ['값 · 플롯', [['space', '값 프리즈'], ['[ ]', '값 스크롤'], ['+ -', '렌더율'],
    ['p', '플롯: 원값·n차 미분/적분·FFT·XY(회귀)·3D']]],
  ['제어 (선택 종류별 x)', [['x on 토픽', 'publish(1회)'], ['x on 서비스', 'call(요청 인자)'],
    ['x on 노드', 'kill'], ['x on 파라미터', 'set'], ['r', '노드 재시작'],
    ['R / P', 'rosbag 녹화 / 재생']]],
  ['도구 · 컨텍스트', [['c', '연결 뷰(pub/sub)'], ['t / T', 'TF 트리 / 두 프레임 echo'], ['S', '노드 리소스(CPU/RSS)'], ['w', '워치리스트'],
    ['b / 1-9', '북마크 — launch·스크립트·자주 쓰는 명령'],
    ['J', '작업(Jobs) 조회·종료'], ['h', 'Hz 측정 모드'], ['D', 'ROS_DOMAIN_ID']]],
  ['기타', [['?', '이 도움말'], ['q', '종료']]],
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
