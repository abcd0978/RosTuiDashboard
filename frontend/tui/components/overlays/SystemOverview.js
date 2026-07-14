// 🩻 시스템 개요 ("ROS htop") — 노드 리소스 + 토픽 Hz + stale + preflight 를 한 화면에. overviewOpen 모드.
//   ↑↓ 스크롤 | Esc 닫기.  리소스는 2초마다 갱신.
import { h, useState, useEffect } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { rosSpawn } from '../../../../shared/ros.js';
import { resourceCmd } from '../../../../shared/commands.js';
import { evalCheck } from '../../../../shared/preflight.js';
import { clamp, pad } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

export function SystemOverview() {
  const d = useDashboard();
  const items = d.topics || [];
  const [res, setRes] = useState([]);

  useEffect(() => {   // 노드 리소스(CPU/RSS) 폴링
    let alive = true, timer;
    const nodes = items.filter((i) => i.kind === 'node').map((i) => i.name);
    const poll = () => {
      if (!nodes.length) return;
      const p = rosSpawn(resourceCmd(nodes)); let out = '';
      if (p.stderr) p.stderr.on('data', () => {});
      p.stdout.on('data', (x) => { out += x.toString(); });
      p.on('close', () => { if (alive) { setRes(out.trim().split('\n').filter((l) => l && !l.startsWith('('))); timer = setTimeout(poll, 2000); } });
      p.on('error', () => {});
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [items.length]);

  const topics = items.filter((i) => i.kind === 'topic');
  const nodes = items.filter((i) => i.kind === 'node');
  const services = items.filter((i) => i.kind === 'service');
  const stale = topics.filter((t) => t.age != null && t.age > 3);
  const byRate = [...topics].sort((a, b) => (b.hz || 0) - (a.hz || 0));
  const pass = d.preflight.filter((c) => evalCheck(c, items).ok).length;

  // 라인 조립(색 포함) — [text, color]
  const L = [];
  L.push([` 노드 ${nodes.length} · 토픽 ${topics.length} · 서비스 ${services.length} · preflight ${pass}/${d.preflight.length}`, 'cyan']);
  L.push(['', null]);
  L.push([` ⚠ stale (수신 끊김 >3s): ${stale.length}`, stale.length ? 'red' : 'green']);
  for (const t of stale.slice(0, 6)) L.push([`   ${pad(t.name, 42)} age ${t.age}s`, 'red']);
  L.push(['', null]);
  L.push([' 📊 노드 리소스 (CPU% / RSS)', 'yellow']);
  if (!res.length) L.push(['   (수집 중 — 독립 프로세스 노드만)', null]);
  for (const r of res.slice(0, 8)) L.push([`   ${r}`, null]);
  L.push(['', null]);
  L.push([' 📈 최고 rate 토픽', 'yellow']);
  for (const t of byRate.slice(0, 8)) L.push([`   ${pad(t.name, 42)} ${pad(String(t.hz), 7)} Hz`, (t.hz || 0) > 0.1 ? null : 'gray']);

  const H = Math.max(4, (d.rows || 20) - 6);
  const maxTop = Math.max(0, L.length - H);
  const [top, setTop] = useState(0);
  const dtop = clamp(top, 0, maxTop);
  useInput((ch, key) => {
    if (key.escape || ch === 'q' || ch === 'O') d.setOverviewOpen(null);
    else if (key.downArrow || ch === 'j') setTop((v) => clamp(v + 1, 0, maxTop));
    else if (key.upArrow || ch === 'k') setTop((v) => clamp(v - 1, 0, maxTop));
    else if (key.pageDown) setTop((v) => clamp(v + H, 0, maxTop));
    else if (key.pageUp) setTop((v) => clamp(v - H, 0, maxTop));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  return h(OverlayFrame, { color: 'cyan', title: '🩻 시스템 개요', hint: `${maxTop > 0 ? `${dtop + 1}/${L.length} ↕  ` : ''}Esc` },
    ...Array.from({ length: Math.min(H, L.length) }, (_, i) => {
      const row = L[dtop + i] || ['', null];
      return h(Text, { key: i, color: row[1] || undefined, wrap: 'truncate-end' }, pad(row[0], w));
    }));
}
