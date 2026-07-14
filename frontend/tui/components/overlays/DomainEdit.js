// ROS 환경 표시(읽기 전용) — domainEdit 모드에서만 마운트.
//
// 예전엔 여기서 ROS_DOMAIN_ID 를 바꿔 다른 도메인의 그래프를 엿볼 수 있었다. 지금은 ROS 에 붙는 주체가
// 백엔드라, TUI 가 자기 환경변수를 바꿔봐야 아무 효과가 없다. 도메인은 백엔드를 띄울 때 정해진다.
// (도메인 "목록"은 애초에 못 보여준다 — DDS 는 어떤 도메인이 존재하는지 알려주지 않는다. 쓰는 값만 알 수 있다.)
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';

export function DomainEdit() {
  const d = useDashboard();
  const e = d.env || {};
  useInput((ch, key) => {
    if (key.escape || key.return || ch === 'q') d.setDomainEdit(null);
  }, { isActive: !!process.stdin.isTTY });

  const row = (k, v) => h(Text, null, h(Text, { dimColor: true }, `${k}: `), h(Text, { color: 'cyan' }, String(v || '—')));

  return h(Box, { flexDirection: 'column' },
    h(Text, { color: 'yellow' }, ' ROS 환경 (백엔드 기준 · 읽기 전용)'),
    row(' 백엔드', `${e.backend}${e.url ? ` → ${e.url}` : ''}`),
    row(' 호스트', e.host),
    row(' ROS', e.ver === '2' ? '2' : '1'),
    e.ver === '2' ? row(' 도메인', `${e.domain}  (rmw: ${e.rmw})`) : row(' 마스터', e.master),
    h(Text, { dimColor: true }, ' 도메인/마스터는 백엔드를 띄울 때 정해진다 — 여기서 못 바꾼다.  Esc 닫기'));
}
