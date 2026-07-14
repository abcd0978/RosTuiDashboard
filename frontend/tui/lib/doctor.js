// 🩺 Doctor — 텔레메트리 그래프를 스캔해 흔한 ROS 통신 문제를 자동 진단한다.
// Foxglove/rviz 엔 없는 기능: RDash 가 이미 모으는 pub/sub·QoS·Hz·age 를 규칙으로 훑어 심각도순 리포트.
// 순수 함수(브라우저/노드 공용). items = 텔레메트리 item 배열. 반환: [{sev, code, target, msg}] (sev: 0=ERROR,1=WARN,2=INFO).
export const SEV = ['ERROR', 'WARN', 'INFO'];

const node = (e) => (Array.isArray(e) ? e[0] : e);
const rel = (e) => (Array.isArray(e) ? e[1] : null);   // 'R' RELIABLE · 'B' BEST_EFFORT
const dur = (e) => (Array.isArray(e) ? e[2] : null);   // 'T' TRANSIENT_LOCAL · 'V' VOLATILE

// staleSec: 이 시간(초) 넘게 값이 안 오면 stale. hidden(/_action/) 토픽은 제외.
export function diagnose(items, { staleSec = 5 } = {}) {
  const out = [];
  const topics = (items || []).filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/'));
  const nodeNames = new Set((items || []).filter((i) => i.kind === 'node').map((i) => i.name));

  for (const t of topics) {
    const pubs = t.pubs || [], subs = t.subs || [];
    // 1) QoS reliability 불일치 — BEST_EFFORT 발행 + RELIABLE 구독 → 구독자가 메시지를 못 받음.
    if (pubs.some((p) => rel(p) === 'B') && subs.some((s) => rel(s) === 'R'))
      out.push({ sev: 0, code: 'qos-reliability', target: t.name, msg: 'QoS 불일치: BEST_EFFORT 발행 → RELIABLE 구독자는 수신 못 함' });
    // 2) QoS durability 불일치 — VOLATILE 발행 + TRANSIENT_LOCAL 구독 → 늦게 붙은 구독자가 latched 값을 못 받음.
    if (pubs.some((p) => dur(p) === 'V') && subs.some((s) => dur(s) === 'T'))
      out.push({ sev: 1, code: 'qos-durability', target: t.name, msg: 'QoS durability: VOLATILE 발행 → TRANSIENT_LOCAL 구독자는 늦게 붙으면 초기값 못 받음' });
    // 3) 발행자만 있고 구독자 없음 — 낭비 발행(dead-end).
    if (pubs.length && !subs.length)
      out.push({ sev: 2, code: 'no-subscriber', target: t.name, msg: `구독자 없음 — ${pubs.map(node).join(', ')} 가 아무도 안 듣는 토픽 발행` });
    // 4) 구독자만 있고 발행자 없음 — 데이터를 기다리는 중(연결 누락 가능).
    if (subs.length && !pubs.length)
      out.push({ sev: 1, code: 'no-publisher', target: t.name, msg: `발행자 없음 — ${subs.map(node).join(', ')} 가 오지 않는 데이터를 대기` });
    // 5) stale — 발행자는 있는데 값이 안 옴(발행 멈춤/죽음).
    if (pubs.length && typeof t.age === 'number' && t.age > staleSec)
      out.push({ sev: 1, code: 'stale', target: t.name, msg: `stale ${t.age.toFixed(1)}s — 발행자 있으나 값이 끊김` });
  }

  // 6) 같은 토픽에 서로 다른 타입? (드묾) — 타입 충돌 감지는 타입 정보가 있을 때만.
  const byType = {};
  for (const t of topics) if (t.ty) (byType[t.name] || (byType[t.name] = new Set())).add(t.ty);

  out.sort((a, b) => a.sev - b.sev || a.target.localeCompare(b.target));
  const counts = { ERROR: 0, WARN: 0, INFO: 0 };
  for (const o of out) counts[SEV[o.sev]]++;
  return { issues: out, counts, scanned: { nodes: nodeNames.size, topics: topics.length } };
}
