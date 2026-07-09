// 토픽 스트림 연결 전/노드 없음 상태 화면.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';

export function Loading() {
  const { ver, conn, quit } = useDashboard();
  useInput((ch) => { if (ch === 'q') quit(); }, { isActive: !!process.stdin.isTTY });   // 연결 전에도 q 종료
  return h(Box, { borderStyle: 'round', borderColor: 'gray', paddingX: 1, width: 64, flexDirection: 'column' },
    h(Text, { bold: true, color: 'cyan' }, ' RDash '),
    h(Text, { color: 'yellow' },
      !ver ? 'ROS 버전 감지 중...'
        : conn === 'ok' ? `ROS${ver} 노드 없음 — 노드 실행되면 자동 연결`
          : `ROS${ver} 연결 중...`),
    h(Text, { dimColor: true }, 'q 종료'));
}
