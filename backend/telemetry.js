// rosbridge 클라이언트 · 텔레메트리 폴링 싱글톤 · 그래프 스냅샷 · echo.
import { RosbridgeClient, msgToYaml } from '../shared/rosbridge.js';
import { be } from './ros.js';
import { sse } from './http.js';

// 연결 두 개를 쓴다: rb 는 그래프/echo(rosapi 호출이 몰린다), rbCmd 는 publish/service/teleop.
// 한 소켓에 섞으면 rosapi backlog 뒤에 명령이 줄을 서서 조작이 몇 초씩 밀린다.
//
// 재연결 워치독은 없다. 예전엔 2 초마다 tcpOpen(9090) 을 찔러 재연결을 유도했는데, 그건 Node 내장(undici)
// WebSocket 이 최초 연결 거부 시 close 를 안 쏴서 자동 재시도가 멈추던 걸 때우려던 것이다. 지금은 ws 패키지를
// 쓰고(error→close 를 제대로 쏜다) RosbridgeClient 가 스스로 백오프 재시도한다 → 워치독은 죽은 땜빵이었다.
let rb = null, rbCmd = null;
export function rbEnsure() { if (!rb) { rb = new RosbridgeClient(be.url); rb.connect(); } return rb; }
export function rbCmdEnsure() { if (!rbCmd) { rbCmd = new RosbridgeClient(be.url); rbCmd.connect(); } return rbCmd; }
rbEnsure();      // 미리 연결 시작 — 연결 전/끊김 동안 rosbridge 필요 라우트는 503
rbCmdEnsure();
export function useRb() { return !!(rb && rb.ready); }
export function useRbCmd() { return !!(rbCmd && rbCmd.ready); }
function rbUnavailable(res) { res.status(503).json({ error: `rosbridge unavailable: ${be.url}` }); return true; }
export function rbRequired(res) { return useRb() ? null : rbUnavailable(res); }
export function rbCmdRequired(res) { return useRbCmd() ? null : rbUnavailable(res); }
export async function rbTopicType(topic) {
  const r = await rbEnsure().call('/rosapi/topic_type', { topic });
  return (r && r.type) || '';
}

// ── 텔레메트리 폴링 싱글톤 — SSE/WS 클라이언트 전원이 폴루프 1개·Hz 구독 하나를 공유(ref-count).
// muxEnsure/muxAdd(mux.js)와 같은 패턴: 첫 구독자가 폴루프 시작, 마지막이 나가면 정지+구독 전부 해제.
const telemClients = new Set();      // 구독 중인 send 콜백들
let telemIv = null, telemBusy = false;   // telemBusy: in-flight 가드 — 이전 틱이 안 끝났으면 이번 틱은 건너뜀(겹침/순서뒤바뀜 방지)
let telemCounts = {}, telemLast = {}, telemTrack = new Map();   // Hz 측정 상태(topic → unsub)
let telemTypes = {};                 // 최근 /rosapi/topics 타입 캐시(measure 변경 시 구독하려면 타입 필요)
let telemSnapshot = null;            // 마지막 정상 스냅샷 — 신규 클라이언트에게 1초 기다리지 않고 즉시 전달
let measure = new Set();             // 브라우저가 화면에 보여주는 토픽만(Hz 측정 대상) — POST /api/measure 로 갱신
// last-known-good 캐시 — rosapi 콜이 타임아웃(null)이어도 이전 값을 그대로 재사용(끊김 플리커 방지)
let cacheNodes = [], cacheServices = [], cacheDetails = new Map();   // node → node_details 응답 {publishing,subscribing}

export function getTelemSnapshot() { return telemSnapshot; }
export function setMeasure(topics) { measure = new Set(topics); measureSync(); }

function measureSync() {   // measure 집합에 맞춰 Hz 구독 갱신 — 틱마다 + /api/measure 갱신 시 즉시 호출
  for (const n of [...telemTrack.keys()]) if (!measure.has(n)) { telemTrack.get(n)(); telemTrack.delete(n); delete telemCounts[n]; delete telemLast[n]; }
  for (const n of measure) if (!telemTrack.has(n) && telemTypes[n] && rb) { telemCounts[n] = 0; telemTrack.set(n, rb.subscribe(n, telemTypes[n], () => { telemCounts[n] = (telemCounts[n] || 0) + 1; telemLast[n] = Date.now(); })); }
}
// ── 관찰자 효과 유령 토픽 ────────────────────────────────────────────────────
// ROS1 마스터는 "발행자든 구독자든 하나라도 있으면" 토픽을 목록에 유지한다. 그런데 rosbridge_suite 는
// 클라이언트가 unsubscribe 를 보내도, 심지어 웹소켓을 끊어도, 마스터에서 자기 구독 등록을 해제하지 않는다
// (생짜 websocket 으로 우리 코드를 배제하고 확인함 — rosbridge 쪽 동작이지 우리 버그가 아니다).
//
// 결과: RDash 가 Hz 를 재거나 echo 한 토픽은, 발행자가 전부 죽은 뒤에도 "구독자 = rosbridge" 때문에
// 마스터 목록에 영원히 남는다. 즉 우리가 쳐다봤다는 이유만으로 존재하는 토픽이 트리에 쌓인다.
//
// 그래서 "발행자 0 + 구독자가 RDash 자신뿐" 인 토픽은 스냅샷에서 뺀다. 이 조건이 정확히 유령만 고른다:
// mavros 처럼 진짜 노드가 구독 중인(발행자를 기다리는) 입력 토픽은 구독자에 그 노드가 있으므로 남는다.
const SELF_NODES = new Set(['/rosbridge_websocket', '/rosapi']);   // RDash 가 ROS 그래프에 남기는 자기 흔적
function isObserverGhost(topic, pub, sub) {
  if (pub && pub.length) return false;            // 발행자가 있으면 유령이 아니다
  if (!sub || !sub.length) return false;          // 아무도 안 붙은 토픽은 마스터가 알아서 지운다
  return sub.every((n) => SELF_NODES.has(n));     // 구독자가 우리뿐 → 우리가 보고 있어서 존재하는 것
}

// 그래프+Hz 스냅샷 — 토픽마다 publishers/subscribers 를 부르는 대신 /rosapi/node_details(노드당 1회)를 뒤집어 pub/sub 엣지 구성.
// 실패(null) 처리: topics 는 이번 틱 전체를 건너뛰도록 null 반환. nodes/services/node_details 는 마지막 정상 값을 재사용.
export async function rbGraphSnapshot(consume = false) {   // consume: 텔레메트리 틱만 true — 이 틱이 Hz 카운팅 창을 닫아야 하므로. /api/graph 의 일회성 조회는 카운트를 훔치면 안 됨.
  const tr = await rb.call('/rosapi/topics');
  if (!tr) return null;   // 타임아웃 — 이번 틱은 건너뜀(호출부에서 처리, 기존 화면 유지)
  const names = tr.topics || [];
  const types = {};
  names.forEach((n, i) => { types[n] = (tr.types || [])[i] || '?'; });
  telemTypes = types;
  measureSync();
  const [nodesR, svcR] = await Promise.all([rb.call('/rosapi/nodes'), rb.call('/rosapi/services')]);
  if (nodesR && nodesR.nodes) cacheNodes = nodesR.nodes;       // null 이면 이전 노드 목록 재사용
  if (svcR && svcR.services) cacheServices = svcR.services;    // null 이면 이전 서비스 목록 재사용
  const details = await Promise.all(cacheNodes.map((nd) => rb.call('/rosapi/node_details', { node: nd })));
  const pubs = {}, subs = {};   // topic → [node, ...] (node_details 를 뒤집어 구성)
  cacheNodes.forEach((nd, i) => {
    const d = details[i];
    if (d) cacheDetails.set(nd, d);   // null 이면 이 노드의 이전 정상 detail 재사용(없으면 빈 값)
    const dd = d || cacheDetails.get(nd) || { publishing: [], subscribing: [] };
    for (const t of dd.publishing || []) (pubs[t] || (pubs[t] = [])).push(nd);
    for (const t of dd.subscribing || []) (subs[t] || (subs[t] = [])).push(nd);
  });
  const now = Date.now();
  const items = [];
  names.forEach((n) => {
    if (isObserverGhost(n, pubs[n], subs[n])) return;   // 우리가 보고 있어서 존재하는 토픽 — 숨긴다(아래 설명)
    const measured = measure.has(n);
    const hz = measured ? (telemCounts[n] || 0) : null;
    if (measured && consume) telemCounts[n] = 0;
    items.push({
      p: 'topics' + n, kind: 'topic', name: n, ty: types[n], hz, age: measured && telemLast[n] ? (now - telemLast[n]) / 1000 : null,
      pubs: (pubs[n] || []).slice().sort().map((x) => [x, null, null]), subs: (subs[n] || []).slice().sort().map((x) => [x, null, null]),
    });
  });
  for (const s of cacheServices) items.push({ p: 'services' + s, kind: 'service', name: s, server: [] });
  for (const nd of cacheNodes) items.push({ p: 'nodes' + nd, kind: 'node', name: nd });
  return { items };
}
async function telemTick() {   // setInterval 본체 — in-flight 가드로 겹쳐 돌지 않게
  if (telemBusy) return;
  telemBusy = true;
  try {
    if (!rb || !rb.ready) {   // 진짜 no-master 일 때만
      const msg = JSON.stringify({ nomaster: true });
      for (const send of telemClients) send(msg);
      return;
    }
    const snap = await rbGraphSnapshot(true);
    if (!snap) return;   // topics 타임아웃 — 아무것도 보내지 않음(브라우저는 기존 화면 유지)
    telemSnapshot = snap;
    const msg = JSON.stringify(snap);
    for (const send of telemClients) send(msg);
  } finally {
    telemBusy = false;
  }
}
export function rbTelemetry(res) {
  const send = sse(res);
  const off = rbTelemetryCore(send);
  res.on('close', off);
}
export function rbTelemetryCore(send) {
  rbEnsure();
  telemClients.add(send);
  if (telemSnapshot) send(JSON.stringify(telemSnapshot));   // 신규 클라이언트: 1초 기다리지 않고 마지막 스냅샷 즉시 전달
  if (!telemIv) telemIv = setInterval(telemTick, 1000);      // 첫 구독자가 폴루프 시작
  return () => {
    telemClients.delete(send);
    if (!telemClients.size) {   // 마지막 클라이언트가 나가면 폴루프 정지 + Hz 구독 전부 해제
      clearInterval(telemIv);
      telemIv = null;
      for (const u of telemTrack.values()) u();
      telemTrack.clear();
      telemCounts = {};
      telemLast = {};
      measure.clear();   // 화면에 보는 사람이 없으므로 측정 대상도 비움 — 남아있으면 새 클라이언트 접속 시 아무도 안 보는 토픽까지 재구독됨
    }
  };
}
export function rbEchoOff(topic, send) {
  rbEnsure();
  let off = () => {};
  rbTopicType(topic).then((type) => { off = rb.subscribe(topic, type, (msg) => send(JSON.stringify(msgToYaml(msg)))); });
  return () => off();
}
export function rbEcho(res, topic) {
  const send = sse(res);
  const off = rbEchoOff(topic, send);
  res.on('close', off);
}
