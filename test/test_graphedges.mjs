// aggregateTopicEdges — 노드↔노드 토픽 엣지 집계. 깨지면 양방향 엣지가 다시 반쪽만 보인다.
//   실행: node test/test_graphedges.mjs
import assert from 'assert';
import { aggregateTopicEdges } from '../frontend/web/lib/graphedges.js';

// 단방향: A pub X → B sub. 엣지 하나, bidir=false, from<to 사전순.
let e = aggregateTopicEdges([{ name: '/x', pubNodes: ['/A'], subNodes: ['/B'] }]);
assert.strictEqual(e.length, 1);
assert.strictEqual(e[0].bidir, false);
assert.deepStrictEqual([e[0].from, e[0].to], ['/A', '/B']);
assert.strictEqual(e[0].dirs.get('/x'), 'ab');

// 양방향: A→B(X) + B→A(Y). 예전엔 엣지 2개(겹침) → 이제 1개로 합쳐지고 bidir=true.
e = aggregateTopicEdges([
  { name: '/x', pubNodes: ['/A'], subNodes: ['/B'] },
  { name: '/y', pubNodes: ['/B'], subNodes: ['/A'] },
]);
assert.strictEqual(e.length, 1, '양방향은 엣지 하나로 합쳐져야 한다');
assert.strictEqual(e[0].bidir, true);
assert.strictEqual(e[0].labels.length, 2);
assert.strictEqual(e[0].dirs.get('/x'), 'ab');   // /A < /B → a=/A → A발행은 ab
assert.strictEqual(e[0].dirs.get('/y'), 'ba');   // B발행→A → ba

// 입력 순서/이름 순서와 무관하게 같은 쌍은 같은 버킷(사전순 고정).
e = aggregateTopicEdges([{ name: '/y', pubNodes: ['/B'], subNodes: ['/A'] }]);
assert.deepStrictEqual([e[0].from, e[0].to], ['/A', '/B']);
assert.strictEqual(e[0].dirs.get('/y'), 'ba');

// 같은 토픽을 두 노드가 서로 pub&sub → 'both', bidir=true.
e = aggregateTopicEdges([{ name: '/z', pubNodes: ['/A', '/B'], subNodes: ['/A', '/B'] }]);
assert.strictEqual(e[0].dirs.get('/z'), 'both');
assert.strictEqual(e[0].bidir, true);

// self-loop(같은 노드가 pub이자 sub)은 엣지가 아니다.
e = aggregateTopicEdges([{ name: '/self', pubNodes: ['/A'], subNodes: ['/A'] }]);
assert.strictEqual(e.length, 0);

// 여러 구독자: A→{B,C} 는 쌍이 둘(A-B, A-C) → 엣지 둘.
e = aggregateTopicEdges([{ name: '/x', pubNodes: ['/A'], subNodes: ['/B', '/C'] }]);
assert.strictEqual(e.length, 2);
assert.ok(e.every((x) => x.bidir === false));

console.log('✅ graphedges 7/7 통과 — 양방향 병합·방향(ab/ba/both)·bidir·self-loop·다중구독');
