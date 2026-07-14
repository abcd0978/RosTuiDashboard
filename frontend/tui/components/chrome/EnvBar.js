// 컨테이너/환경 컨텍스트 줄 — 어느 host·도메인·rmw 의 그래프를 보는지 + Hz 측정 모드.
import { h } from '../../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../../store.js';

export function EnvBar() {
  const { env, hzMode, rec, triggerArmed } = useDashboard();
  const parts = [`⬢ ${env.host}`, `ROS${env.ver || '?'}`];
  if (env.ver === '2') parts.push(`dom:${env.domain}`, `rmw:${env.rmw}`);
  else if (env.master) parts.push(`master:${env.master.replace(/^https?:\/\//, '')}`);
  parts.push(`Hz:${hzMode}`);
  if (process.env.RDASH_WEB_ACTIVE) parts.push(`web:${process.env.RDASH_WEB_ACTIVE}`);
  const base = h(Text, { dimColor: true }, ' ' + parts.join('  ·  '));
  if (triggerArmed) return h(Box, null, base, h(Text, { color: 'red', bold: true }, '   🔴 TRIG'));
  if (!rec) return base;
  const el = Math.floor((Date.now() - rec.started) / 1000);   // 경과(초)
  const mmss = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
  return h(Box, null, base,
    h(Text, { color: 'red', bold: true }, `   ● REC ${rec.n ? rec.n + 't' : 'all'} ${mmss} ${rec.out}`));
}
