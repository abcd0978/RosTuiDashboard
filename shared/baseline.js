// 📌 Baseline & 회귀 — "정상일 때"의 시스템 프로파일(노드·토픽 Hz·서비스)을 저장해두고 라이브와 diff.
// Foxglove/rviz 엔 없는 기능: 노드 누락·Hz 저하·토픽 증발을 기준선 대비로 자동 감지(현장/CI 디버깅).
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const FILE = join(homedir(), '.rdash_baseline.json');

export function loadBaseline() { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return null; } }
export function saveBaseline(profile) { try { writeFileSync(FILE, JSON.stringify(profile)); return true; } catch { return false; } }

// 현재 텔레메트리 → 프로파일. at 은 호출자가 타임스탬프 주입(라이브러리 순수성 유지).
export function snapshot(items, at = 0) {
  const list = items || [];
  const nodes = list.filter((i) => i.kind === 'node').map((i) => i.name).sort();
  const services = list.filter((i) => i.kind === 'service').map((i) => i.name).sort();
  const topics = {};
  for (const t of list.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/'))) topics[t.name] = { hz: t.hz || 0, ty: t.ty || '' };
  return { at, nodes, topics, services };
}

// base(저장 프로파일) vs items(라이브) → [{sev, target, msg}] (0=ERROR,1=WARN,2=INFO). hzTol: 상대 Hz 허용오차.
export function diffBaseline(base, items, { hzTol = 0.3 } = {}) {
  const out = [];
  if (!base) return out;
  const now = snapshot(items);
  const bn = new Set(base.nodes || []), nn = new Set(now.nodes);
  for (const n of base.nodes || []) if (!nn.has(n)) out.push({ sev: 0, target: n, msg: '노드 사라짐 (기준선엔 있었음)' });
  for (const n of now.nodes) if (!bn.has(n)) out.push({ sev: 2, target: n, msg: '노드 추가됨 (기준선엔 없음)' });
  const bt = base.topics || {};
  for (const t in bt) if (!(t in now.topics)) out.push({ sev: 1, target: t, msg: '토픽 사라짐 (기준선엔 있었음)' });
  for (const t in now.topics) if (!(t in bt)) out.push({ sev: 2, target: t, msg: '토픽 추가됨 (기준선엔 없음)' });
  for (const t in bt) if (t in now.topics) {
    const b = bt[t].hz, c = now.topics[t].hz;
    if (b > 0.5) { const drift = (c - b) / b; if (Math.abs(drift) > hzTol) out.push({ sev: drift < 0 ? 1 : 2, target: t, msg: `Hz ${b.toFixed(1)}→${c.toFixed(1)} (${drift > 0 ? '+' : ''}${(drift * 100).toFixed(0)}%)` }); }
  }
  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  return out;
}
