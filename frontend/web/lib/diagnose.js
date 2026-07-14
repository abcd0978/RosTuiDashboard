/* Doctor(헬스 스캔) — src/lib/doctor.js 와 동일 규칙을 브라우저에서 */

export const SEV = ['ERROR', 'WARN', 'INFO'];

export function diagnose(list) {
  const out = [];
  const tp = list.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/'));
  const rel = (e) => (Array.isArray(e) ? e[1] : null), dur = (e) => (Array.isArray(e) ? e[2] : null), nm = (e) => (Array.isArray(e) ? e[0] : e);
  for (const t of tp) {
    const pubs = t.pubs || [], subs = t.subs || [];
    if (pubs.some((p) => rel(p) === 'B') && subs.some((s) => rel(s) === 'R')) out.push({ sev: 0, target: t.name, msg: 'QoS 불일치: BEST_EFFORT 발행 → RELIABLE 구독자는 수신 못 함' });
    if (pubs.some((p) => dur(p) === 'V') && subs.some((s) => dur(s) === 'T')) out.push({ sev: 1, target: t.name, msg: 'QoS durability: VOLATILE 발행 → TRANSIENT_LOCAL 구독자는 초기값 못 받음' });
    if (pubs.length && !subs.length) out.push({ sev: 2, target: t.name, msg: '구독자 없음 — ' + pubs.map(nm).join(', ') + ' 가 아무도 안 듣는 토픽 발행' });
    if (subs.length && !pubs.length) out.push({ sev: 1, target: t.name, msg: '발행자 없음 — ' + subs.map(nm).join(', ') + ' 가 오지 않는 데이터를 대기' });
    if (pubs.length && typeof t.age === 'number' && t.age > 5) out.push({ sev: 1, target: t.name, msg: 'stale ' + t.age.toFixed(1) + 's — 발행자 있으나 값이 끊김' });
  }
  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  const counts = { ERROR: 0, WARN: 0, INFO: 0 };
  out.forEach((o) => counts[SEV[o.sev]]++);
  return { issues: out, counts, scanned: { nodes: list.filter((i) => i.kind === 'node').length, topics: tp.length } };
}
