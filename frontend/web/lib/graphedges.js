/* 노드↔노드 토픽 엣지 집계 — 순수 함수(DOM 의존 없음, test/test_graphedges.mjs 가 검증).
 *
 * 무방향 쌍으로 묶는다: A 가 토픽 X 를 발행→B 구독, B 가 토픽 Y 를 발행→A 구독이면 엣지 하나로 합치고
 * 방향은 토픽별로 dirs 에 담는다. 예전엔 A→B, B→A 를 방향별로 따로 만들어 같은 좌표에 직선을 겹쳐 그려,
 * 뒤 방향 엣지가 클릭도 안 되고(최단거리 동률 → 배열 앞선 것만 선택) 화면에서도 구분이 안 됐다.
 *
 * 입력: [{ name, pubNodes:[...], subNodes:[...] }]  — 호출측이 nodeName/keepNode 로 이미 걸러 넘긴다.
 * 출력: [{ from, to, kind:'topic', labels:[토픽명], dirs:Map<토픽명,'ab'|'ba'|'both'>, bidir }]
 *   from<to 사전순 고정 → 입력 순서와 무관하게 같은 쌍은 같은 엣지. 'ab'=from→to, 'ba'=to→from.
 */
export function aggregateTopicEdges(topics) {
  const agg = new Map();   // 'A\0B'(사전순) → { a, b, dirs:Map }
  for (const t of topics) {
    for (const p of t.pubNodes) for (const s of t.subNodes) {
      if (p === s) continue;                              // self-loop 은 엣지가 아니다
      const [a, b] = p < s ? [p, s] : [s, p];             // 사전순 고정 → 두 방향이 같은 버킷
      const k = a + '\0' + b;
      let rec = agg.get(k);
      if (!rec) { rec = { a, b, dirs: new Map() }; agg.set(k, rec); }
      const dir = p === a ? 'ab' : 'ba';                  // 이 토픽이 흐르는 방향
      const prev = rec.dirs.get(t.name);
      rec.dirs.set(t.name, prev && prev !== dir ? 'both' : dir);   // 같은 토픽이 양쪽으로 흐르면 both
    }
  }
  const edges = [];
  for (const rec of agg.values()) {
    const ds = new Set();
    for (const d of rec.dirs.values()) { if (d === 'both') { ds.add('ab'); ds.add('ba'); } else ds.add(d); }
    edges.push({ from: rec.a, to: rec.b, kind: 'topic', labels: [...rec.dirs.keys()], dirs: rec.dirs, bidir: ds.has('ab') && ds.has('ba') });
  }
  return edges;
}
