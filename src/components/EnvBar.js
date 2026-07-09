// 컨테이너/환경 컨텍스트 줄 — 어느 host·도메인·rmw 의 그래프를 보는지 + Hz 측정 모드.
import { h } from '../react.js';
import { Text } from 'ink';
import { useDashboard } from '../store.js';

export function EnvBar() {
  const { env, hzMode } = useDashboard();
  const parts = [`⬢ ${env.host}`, `ROS${env.ver || '?'}`];
  if (env.ver === '2') parts.push(`dom:${env.domain}`, `rmw:${env.rmw}`);
  else if (env.master) parts.push(`master:${env.master.replace(/^https?:\/\//, '')}`);
  parts.push(`Hz:${hzMode}`);
  return h(Text, { dimColor: true }, ' ' + parts.join('  ·  '));
}
