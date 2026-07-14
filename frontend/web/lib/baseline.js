/* Baseline/회귀 — src/lib/baseline.js 와 동일 규칙(브라우저) */

export function snapProfile(list) {
  const nodes = list.filter((i) => i.kind === 'node').map((i) => i.name).sort();
  const services = list.filter((i) => i.kind === 'service').map((i) => i.name).sort();
  const topics = {};
  list.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/')).forEach((t) => { topics[t.name] = { hz: t.hz ?? null, ty: t.ty || '' }; });
  return { at: 0, nodes, topics, services };
}

export function diffBaseline(base, list, hzTol = 0.3) {
  const out = [];
  if (!base) return out;
  const now = snapProfile(list);
  const bn = new Set(base.nodes || []), nn = new Set(now.nodes);
  (base.nodes || []).forEach((n) => { if (!nn.has(n)) out.push({ sev: 0, target: n, msg: '노드 사라짐 (기준선엔 있었음)' }); });
  now.nodes.forEach((n) => { if (!bn.has(n)) out.push({ sev: 2, target: n, msg: '노드 추가됨 (기준선엔 없음)' }); });
  const bt = base.topics || {};
  for (const t in bt) if (!(t in now.topics)) out.push({ sev: 1, target: t, msg: '토픽 사라짐 (기준선엔 있었음)' });
  for (const t in now.topics) if (!(t in bt)) out.push({ sev: 2, target: t, msg: '토픽 추가됨 (기준선엔 없음)' });
  for (const t in bt) if (t in now.topics) {
    const b = bt[t].hz, c = now.topics[t].hz;
    if (b > 0.5 && c != null) {
      const dr = (c - b) / b;
      if (Math.abs(dr) > hzTol) out.push({ sev: dr < 0 ? 1 : 2, target: t, msg: `Hz ${b.toFixed(1)}→${c.toFixed(1)} (${dr > 0 ? '+' : ''}${(dr * 100).toFixed(0)}%)` });
    }   // null = 측정 안 함(화면에 없음) 이므로 비교에서 제외
  }
  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  return out;
}
