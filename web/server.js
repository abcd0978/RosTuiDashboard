// RDash 웹 서버 — TUI 와 같은 텔레메트리/명령 인프라를 재사용해 브라우저 UI 를 localhost 로 서빙.
// 목표: TUI 의 모든 기능을 웹에서도. 이 파일은 명령을 노출하는 얇은 API(SSE 스트림 + JSON 액션)일 뿐,
// 로직 빌더는 전부 src/lib 재사용.  실행: node web/server.js (npm run web) · 포트 RDASH_WEB_PORT(기본 8080)
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { spawnSync } from 'child_process';
import { rosSpawn } from '../src/lib/ros.js';
import { flattenSkeleton, buildYaml } from '../src/lib/msgform.js';
import { loadBookmarks, saveBookmarks } from '../src/lib/bookmarks.js';
import { loadPreflight } from '../src/lib/preflight.js';
import { loadBaseline, saveBaseline } from '../src/lib/baseline.js';
import { makeBackend } from '../src/lib/backend.js';
import { RosbridgeClient, msgToYaml, looseJson } from '../src/lib/rosbridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RDASH_WEB_PORT) || 8080;
// 바인딩 주소 — 기본 0.0.0.0(모든 인터페이스): 컨테이너 안에서 돌려도 -p 로 포트만 노출하면 호스트에서 접속 가능.
// 로컬 전용으로 잠그려면 RDASH_WEB_HOST=127.0.0.1.
const HOST = process.env.RDASH_WEB_HOST || '0.0.0.0';

function detectVer() {
  if (process.env.ROS_VER) return process.env.ROS_VER;
  const r = spawnSync('bash', ['-lc', 'command -v ros2 >/dev/null 2>&1']);
  return r.status === 0 ? '2' : '1';
}
const VER = detectVer();
// 모든 ROS 조작은 이 백엔드 인터페이스를 통해서만. RDASH_BACKEND 로 구현체 교체(현재 cli).
const be = makeBackend(VER);

// ── 유틸 ──────────────────────────────────────────────────────────────────
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('\n');
  return (data) => res.write(`data: ${data}\n\n`);
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function runOnce(cmd) {
  return new Promise((resolve) => {
    const p = rosSpawn(`${cmd}`); let out = '';
    if (p.stderr) p.stderr.on('data', (d) => { out += d.toString(); });
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', () => resolve(out));
    p.on('error', () => resolve(out || '(exec error)'));
  });
}
function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}

// ── 스트림(SSE) ───────────────────────────────────────────────────────────
function telemScript() { if (process.env.RDASH_TELEM) { try { return readFileSync(process.env.RDASH_TELEM, 'utf8'); } catch { /* */ } } return be.telemetryScript(); }
function streamLines(res, cmd, writeScript) {
  const send = sse(res);
  const child = rosSpawn(cmd);
  if (writeScript) { child.stdin.on('error', () => {}); child.stdin.write(writeScript); child.stdin.end(); }
  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) send(l); } });
  if (child.stderr) child.stderr.on('data', () => {});
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}
function streamBlocks(res, cmd) {   // '---' 구분 블록(echo/diagnostics)
  const send = sse(res);
  const child = rosSpawn(cmd);
  let buf = '';
  child.stdout.on('data', (d) => { buf += d.toString(); const parts = buf.split('\n---\n'); while (parts.length > 1) { const b = parts.shift().trimEnd(); if (b) send(JSON.stringify(b)); } buf = parts[0]; });
  if (child.stderr) child.stderr.on('data', () => {});
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}

// ── echo 멀티플렉서 — usesMux 백엔드(RDASH_BACKEND=rcl)에서 토픽별 echo 를 프로세스 1개로 팬아웃(폭증 해결) ──
let muxChild = null; const muxSubs = new Map();   // topic → Set(send)
function muxEnsure() {
  if (muxChild) return muxChild;
  muxChild = rosSpawn(be.echoMux());
  let buf = '';
  muxChild.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const set = muxSubs.get(o.t); if (set) for (const send of set) send(JSON.stringify(o.b)); } });
  if (muxChild.stderr) muxChild.stderr.on('data', () => {});
  muxChild.on('close', () => { muxChild = null; });   // 죽으면 다음 요청에 재기동
  return muxChild;
}
function muxStream(res, topic) {
  const send = sse(res); muxEnsure();
  if (!muxSubs.has(topic)) { muxSubs.set(topic, new Set()); try { muxChild.stdin.write('+' + topic + '\n'); } catch { /* */ } }
  muxSubs.get(topic).add(send);
  res.on('close', () => { const s = muxSubs.get(topic); if (s) { s.delete(send); if (!s.size) { muxSubs.delete(topic); try { muxChild && muxChild.stdin.write('-' + topic + '\n'); } catch { /* */ } } } });
}
const echoStream = (res, topic) => (be.usesMux ? muxStream(res, topic) : streamBlocks(res, be.echo(topic)));

// ── rosbridge(원격 websocket) 백엔드 — 로컬 ROS 없이 원격 로봇의 rosbridge_suite 에 연결 ──
let rb = null;
function rbEnsure() { if (!rb) { rb = new RosbridgeClient(be.url); rb.connect(); } return rb; }
async function rbTopicType(topic) { const r = await rbEnsure().call('/rosapi/topic_type', { topic }); return (r && r.type) || ''; }
// 그래프+Hz 를 rosapi 로 폴링해 telemetry.py 와 같은 items 스트림 생성.
function rbTelemetry(res) {
  const send = sse(res); rbEnsure();
  const counts = {}, last = {}, unsub = new Map(); let alive = true;
  const iv = setInterval(async () => {
    if (!alive) return;
    const tr = await rb.call('/rosapi/topics'); if (!tr) { send(JSON.stringify({ nomaster: true })); return; }
    const names = tr.topics || [], types = {}; names.forEach((n, i) => { types[n] = (tr.types || [])[i] || '?'; });
    for (const n of names) if (!unsub.has(n)) { counts[n] = 0; unsub.set(n, rb.subscribe(n, types[n], () => { counts[n] = (counts[n] || 0) + 1; last[n] = Date.now(); })); }
    for (const n of [...unsub.keys()]) if (!(n in types)) { unsub.get(n)(); unsub.delete(n); }
    const [nodesR, svcR] = await Promise.all([rb.call('/rosapi/nodes'), rb.call('/rosapi/services')]);
    const edges = await Promise.all(names.map((n) => Promise.all([rb.call('/rosapi/publishers', { topic: n }), rb.call('/rosapi/subscribers', { topic: n })])));
    const now = Date.now(); const items = [];
    names.forEach((n, i) => { const [pubR, subR] = edges[i] || [{}, {}];
      const hz = counts[n] || 0; counts[n] = 0;
      items.push({ p: 'topics' + n, kind: 'topic', name: n, ty: types[n], hz, age: last[n] ? (now - last[n]) / 1000 : null,
        pubs: ((pubR && pubR.publishers) || []).map((x) => [x, null, null]), subs: ((subR && subR.subscribers) || []).map((x) => [x, null, null]) }); });
    for (const s of (svcR && svcR.services) || []) items.push({ p: 'services' + s, kind: 'service', name: s, server: [] });
    for (const nd of (nodesR && nodesR.nodes) || []) items.push({ p: 'nodes' + nd, kind: 'node', name: nd });
    send(JSON.stringify({ items }));
  }, 1000);
  res.on('close', () => { alive = false; clearInterval(iv); for (const u of unsub.values()) u(); });
}
function rbEcho(res, topic) {
  const send = sse(res); rbEnsure();
  rbTopicType(topic).then((type) => { const off = rb.subscribe(topic, type, (msg) => send(JSON.stringify(msgToYaml(msg)))); res.on('close', off); });
}

// ── 잡(Jobs) 레지스트리 — 웹에서 띄운 프로세스(북마크·rosbag·액션) 추적 ──
let jobSeq = 0;
const jobs = new Map();   // id → {id,label,pid,status,log[]}
function spawnJob(label, cmd) {
  const id = ++jobSeq;
  const child = rosSpawn(cmd, undefined, true);
  const rec = { id, label, pid: child.pid, status: 'run', log: [], child };
  const push = (s) => { for (const ln of String(s).split('\n')) if (ln !== '') { rec.log.push(ln); if (rec.log.length > 400) rec.log.shift(); } };
  if (child.stdout) child.stdout.on('data', (d) => push(d.toString()));
  if (child.stderr) child.stderr.on('data', (d) => push(d.toString()));
  child.on('close', (code) => { rec.status = code ? 'error' : 'done'; });
  child.on('error', () => { rec.status = 'error'; });
  jobs.set(id, rec);
  return rec;
}
function jobView(r) { return { id: r.id, label: r.label, pid: r.pid, status: r.status, log: r.log.slice(-30) }; }

// ── Teleop — geometry_msgs/Twist 지속 퍼블리셔 하나를 관리(Foxglove Teleop 패널 대응) ──
let teleopId = null;
function teleopStop(topic) {
  if (teleopId && jobs.has(teleopId)) { const r = jobs.get(teleopId); try { process.kill(-r.child.pid, 'SIGINT'); } catch { try { r.child.kill('SIGINT'); } catch { /* */ } } }
  teleopId = null;
  if (topic) { const cmd = be.publish(topic, '{linear: {x: 0.0, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}'); if (cmd) runOnce(cmd); }   // 정지 시 0 트위스트 1회
}
function teleopSet(topic, lin, ang) {
  teleopStop();   // 이전 퍼블리셔 정리(0 발행 없이)
  teleopId = spawnJob(`teleop ${topic}`, be.teleop(topic, lin, ang)).id;
}

// ── 정적 파일 ─────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
function serveFile(res, name) {
  try { const body = readFileSync(join(HERE, name)); res.writeHead(200, { 'Content-Type': MIME[extname(name)] || 'text/plain' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
}

// ── 라우팅 ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname; const q = url.searchParams; const post = req.method === 'POST';
  try {
    if (p === '/' || p === '/index.html') return serveFile(res, 'index.html');
    if (p === '/app.js') return serveFile(res, 'app.js');
    if (p === '/workspace.js') return serveFile(res, 'workspace.js');
    if (p === '/popup.html') return serveFile(res, 'popup.html');
    if (p === '/api/ver') return json(res, 200, { ver: VER });
    if (p === '/api/preflight') return json(res, 200, { checks: loadPreflight() });

    // 스트림
    if (p === '/events') return be.kind === 'rosbridge' ? rbTelemetry(res) : streamLines(res, 'python3 -', telemScript());
    if (p === '/echo') return q.get('topic') ? (be.kind === 'rosbridge' ? rbEcho(res, q.get('topic')) : echoStream(res, q.get('topic'))) : json(res, 400, { error: 'topic' });
    if (p === '/imgstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.imgBridge(t)); }
    if (p === '/cloudstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.cloudBridge(t)); }
    if (p === '/markerstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.markerBridge(t)); }
    if (p === '/tfstream') return streamLines(res, be.tfDump());
    if (p === '/annstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.imgAnnBridge(t)); }
    if (p === '/caminfostream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.camInfoBridge(t)); }
    if (p === '/geomstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, be.geomBridge(t, q.get('type') || '')); }
    if (p === '/rosout') return be.kind === 'rosbridge' ? rbEcho(res, '/rosout') : (be.usesMux ? muxStream(res, '/rosout') : streamBlocks(res, be.rosout()));
    if (p === '/diagnostics') return be.kind === 'rosbridge' ? rbEcho(res, '/diagnostics') : (be.usesMux ? muxStream(res, '/diagnostics') : streamBlocks(res, be.diagnostics()));

    // 조회(one-shot)
    if (p === '/api/msgdef') return json(res, 200, { out: await runOnce(be.msgDef(q.get('type'))) });
    if (p === '/api/proto') {   // 발행 폼 프리필: 타입 스켈레톤 → flow-style YAML 한 줄 (TUI 와 동일)
      const cmd = be.proto(q.get('name'), q.get('type'));
      if (!cmd) return json(res, 200, { yaml: '{}' });
      try { const skel = JSON.parse((await runOnce(cmd)).trim() || '{}').skel || {}; return json(res, 200, { yaml: buildYaml(flattenSkeleton(skel)) || '{}' }); }
      catch { return json(res, 200, { yaml: '{}' }); }
    }
    if (p === '/api/bagdump') { const out = await runOnce(be.bagDump(q.get('path'), q.get('topics'))); try { return json(res, 200, JSON.parse(out)); } catch { return json(res, 200, { series: {}, error: out.slice(0, 300) }); } }
    if (p === '/api/connections') { if (be.kind === 'rosbridge') { const kind = q.get('kind'), name = q.get('name'), rbc = rbEnsure();
      if (kind === 'topic') { const [pu, su, ty] = await Promise.all([rbc.call('/rosapi/publishers', { topic: name }), rbc.call('/rosapi/subscribers', { topic: name }), rbc.call('/rosapi/topic_type', { topic: name })]);
        return json(res, 200, { out: `Type: ${(ty && ty.type) || '?'}\nPublishers:\n  ${(((pu && pu.publishers) || []).join('\n  ')) || '(none)'}\nSubscribers:\n  ${(((su && su.subscribers) || []).join('\n  ')) || '(none)'}` }); }
      const nd = await rbc.call('/rosapi/node_details', { node: name }); return json(res, 200, { out: nd ? JSON.stringify(nd, null, 2) : '(rosbridge: 조회 실패)' }); }
      return json(res, 200, { out: await runOnce(be.connections(q.get('kind'), q.get('name'))) }); }
    if (p === '/api/resource') { const b = await readBody(req); return json(res, 200, { out: await runOnce(be.resource(b.nodes || [])) }); }
    if (p === '/api/tftree') return json(res, 200, { out: await runOnce(be.tfTree()) });
    if (p === '/api/tfecho') return json(res, 200, { out: await runOnce(be.tfEcho(q.get('src'), q.get('tgt'))) });
    if (p === '/api/bagcompare') return json(res, 200, { out: await runOnce(be.bagCompare(q.get('a'), q.get('b'))) });
    if (p === '/api/param/list') return json(res, 200, { rows: (await runOnce(be.paramList(q.get('node')))).split('\n').filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { name: i < 0 ? l : l.slice(0, i), value: (i < 0 ? '' : l.slice(i + 1)).trim() }; }) });

    // 액션(POST)
    if (p === '/api/run' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(`${b.cmd} 2>&1`) }); }
    if (p === '/api/param/set' && post) { const b = await readBody(req); await runOnce(be.paramSet(b.node, b.name, b.value)); return json(res, 200, { value: (await runOnce(be.paramGet(b.node, b.name))).trim() }); }
    if (p === '/api/publish' && post) { const b = await readBody(req); if (be.kind === 'rosbridge') { rbEnsure().publish(b.name, await rbTopicType(b.name), looseJson(b.msg)); return json(res, 200, { out: 'published (rosbridge)' }); } const cmd = be.publish(b.name, b.msg); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/service' && post) { const b = await readBody(req); if (be.kind === 'rosbridge') { const v = await rbEnsure().call(b.name, looseJson(b.req)); return json(res, 200, { out: v == null ? '(no response)' : JSON.stringify(v, null, 2) }); } const cmd = be.serviceCall(b.name, b.req); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/setparam1' && post) { const b = await readBody(req); const cmd = be.setParam1(b.name, b.value); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(ROS2: per-node)' }); }
    if (p === '/api/killnode' && post) { const b = await readBody(req); const cmd = be.killNode(b.name); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/restart' && post) { const b = await readBody(req); const cmd = be.restartNode(b.name); return json(res, 200, { out: cmd ? await runOnce(cmd) : '(no cmd)' }); }
    if (p === '/api/lifecycle' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(be.lifecycle(b.node, b.transition)) }); }

    // 잡
    if (p === '/api/jobs' && !post) return json(res, 200, { jobs: [...jobs.values()].map(jobView) });
    if (p === '/api/job' && post) { const b = await readBody(req); const r = spawnJob(b.label || b.cmd, b.cmd); return json(res, 200, jobView(r)); }
    if (p === '/api/action' && post) { const b = await readBody(req); const r = spawnJob(`action ${b.name}`, be.actionGoal(b.name, b.type, b.goal)); return json(res, 200, jobView(r)); }
    if (p === '/api/teleop' && post) { const b = await readBody(req); const topic = b.topic || '/cmd_vel'; if (b.stop) teleopStop(topic); else teleopSet(topic, Number(b.lin) || 0, Number(b.ang) || 0); return json(res, 200, { ok: true }); }
    if (p === '/api/record' && post) { const b = await readBody(req); const out = `rdash_rec_${Date.now()}`; const r = spawnJob(`rosbag rec → ${out}`, be.bagRecord(b.topics && b.topics.length ? b.topics : null, out)); return json(res, 200, jobView(r)); }
    if (p === '/api/play' && post) { const b = await readBody(req); const r = spawnJob(`rosbag play ${b.path}`, be.bagPlay(b.path)); return json(res, 200, jobView(r)); }
    if (p.startsWith('/api/job/') && p.endsWith('/kill') && post) { const id = Number(p.split('/')[3]); const r = jobs.get(id); if (r) { try { process.kill(-r.child.pid, 'SIGINT'); } catch { try { r.child.kill('SIGINT'); } catch { /* */ } } } return json(res, 200, { ok: true }); }

    // 기준선(Baseline) — 프로파일은 브라우저가 계산해 저장, diff 도 브라우저에서.
    if (p === '/api/baseline' && !post) return json(res, 200, { baseline: loadBaseline() });
    if (p === '/api/baseline' && post) { const b = await readBody(req); saveBaseline(b.profile || {}); return json(res, 200, { ok: true }); }

    // 북마크
    if (p === '/api/bookmarks' && !post) return json(res, 200, { bookmarks: loadBookmarks() });
    if (p === '/api/bookmarks' && post) { const b = await readBody(req); saveBookmarks(b.bookmarks || []); return json(res, 200, { ok: true }); }

    res.writeHead(404); res.end('not found');
  } catch (e) { json(res, 500, { error: String(e && e.message || e) }); }
});

// 종료 시 잡 정리
function cleanup() { for (const r of jobs.values()) { try { process.kill(-r.child.pid, 'SIGTERM'); } catch { /* */ } } try { muxChild && muxChild.kill(); } catch { /* */ } }
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(0); });

server.listen(PORT, HOST, () => {
  console.log(`RDash web (ROS${VER}) — ${HOST}:${PORT} 리스닝`);
  console.log(`  로컬:  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  호스트/원격: http://<컨테이너-또는-호스트-IP>:${PORT}  (컨테이너면 docker -p ${PORT}:${PORT} 또는 --network host 필요)`);
});
