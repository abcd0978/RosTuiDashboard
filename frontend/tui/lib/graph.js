// 노드 통신 토폴로지 — 텔레메트리 item(토픽별 pubs/subs 엣지: [node, rel, dur])에서 그래프를 만든다.
// rqt_graph 의 터미널판: 노드 중심(선택 노드가 뭘 주고받나) + 전체 엣지 목록.
const nodeName = (e) => (Array.isArray(e) ? e[0] : e);

// 토픽별 엣지 [{topic, ty, pubs:[node], subs:[node]}] — pubs/subs 는 노드명 배열.
export function topicEdges(items) {
  return (items || [])
    .filter((it) => it.kind === 'topic')
    .map((it) => ({ topic: it.name, ty: it.ty, pubs: (it.pubs || []).map(nodeName), subs: (it.subs || []).map(nodeName) }));
}

// 노드 중심 인접 — Map(node → { pub:[{topic,to:[node]}], sub:[{topic,from:[node]}] })
export function nodeAdjacency(items) {
  const edges = topicEdges(items);
  const adj = new Map();
  const ensure = (n) => { if (!adj.has(n)) adj.set(n, { pub: [], sub: [] }); return adj.get(n); };
  for (const it of items || []) if (it.kind === 'node') ensure(it.name);   // 엣지 없는 노드도 포함
  for (const e of edges) {
    for (const p of e.pubs) ensure(p).pub.push({ topic: e.topic, to: e.subs.filter((s) => s !== p) });
    for (const s of e.subs) ensure(s).sub.push({ topic: e.topic, from: e.pubs.filter((p) => p !== s) });
  }
  return adj;
}

// 화면 라인 — focus(노드명) 있으면 노드 중심, 없으면 전체 엣지.
export function graphLines(items, focus) {
  if (focus) {
    const a = nodeAdjacency(items).get(focus) || { pub: [], sub: [] };
    const out = [`◆ ${focus}`, '', ' ▲ publishes ─────────────'];
    if (!a.pub.length) out.push('     (none)');
    for (const p of a.pub.sort((x, y) => x.topic.localeCompare(y.topic))) {
      out.push(`   ${p.topic}`);
      out.push(`      └▶ ${p.to.length ? p.to.join(', ') : '(구독자 없음)'}`);
    }
    out.push('', ' ▼ subscribes ────────────');
    if (!a.sub.length) out.push('     (none)');
    for (const s of a.sub.sort((x, y) => x.topic.localeCompare(y.topic))) {
      out.push(`   ${s.topic}`);
      out.push(`      ◀┘ ${s.from.length ? s.from.join(', ') : '(발행자 없음)'}`);
    }
    return out;
  }
  // 전체: publisher(들) ──topic──▶ subscriber(들)
  const edges = topicEdges(items).filter((e) => e.pubs.length || e.subs.length);
  edges.sort((x, y) => x.topic.localeCompare(y.topic));
  const out = edges.map((e) => {
    const pl = e.pubs.length ? e.pubs.join(',') : '∅';
    const sl = e.subs.length ? e.subs.join(', ') : '(구독자 없음)';
    return `${pl}  ──[${e.topic}]──▶  ${sl}`;
  });
  return out.length ? out : ['(엣지 없음 — pub/sub 관계를 못 읽었습니다. ROS2 daemon / 권한을 확인하세요)'];
}
