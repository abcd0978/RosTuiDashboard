// RDash 웹 서버 — TUI 와 같은 텔레메트리/명령 인프라를 재사용해 브라우저 UI 를 localhost 로 서빙.
// 목표: TUI 의 모든 기능을 웹에서도. 이 파일은 명령을 노출하는 얇은 API(SSE 스트림 + JSON 액션)일 뿐,
// 로직 빌더는 전부 src/lib 재사용.  실행: node web/server.js (npm run web) · 포트 RDASH_WEB_PORT(기본 8080)
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { spawnSync } from 'child_process';
import { rosSpawn, echoFullCmd, actionFor, restartFor, protoCmd } from '../src/lib/ros.js';
import { flattenSkeleton, buildYaml } from '../src/lib/msgform.js';
import { TELEM, TELEM2, IMG_BRIDGE, CLOUD_BRIDGE } from '../src/lib/paths.js';
import {
  connectionsCmd, resourceCmd, tfTreeCmd, tfEchoCmd, bagRecordCmd, bagPlayCmd, bagCompareCmd,
  msgDefCmd, paramListCmd, paramGetCmd, paramSetCmd,
} from '../src/lib/commands.js';
import { loadBookmarks, saveBookmarks } from '../src/lib/bookmarks.js';
import { loadPreflight } from '../src/lib/preflight.js';
import { loadBaseline, saveBaseline } from '../src/lib/baseline.js';
import { shq } from '../src/lib/util.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RDASH_WEB_PORT) || 8080;

function detectVer() {
  if (process.env.ROS_VER) return process.env.ROS_VER;
  const r = spawnSync('bash', ['-lc', 'command -v ros2 >/dev/null 2>&1']);
  return r.status === 0 ? '2' : '1';
}
const VER = detectVer();

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
function telemScript() { if (process.env.RDASH_TELEM) { try { return readFileSync(process.env.RDASH_TELEM, 'utf8'); } catch { /* */ } } return VER === '2' ? TELEM2 : TELEM; }
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
function twistYaml(lin, ang) { return `{linear: {x: ${lin}, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: ${ang}}}`; }
function teleopStop(topic) {
  if (teleopId && jobs.has(teleopId)) { const r = jobs.get(teleopId); try { process.kill(-r.child.pid, 'SIGINT'); } catch { try { r.child.kill('SIGINT'); } catch { /* */ } } }
  teleopId = null;
  if (topic) { const zero = twistYaml(0, 0); const a = actionFor(VER, 'topic', topic, zero); if (a && a.cmd) runOnce(a.cmd); }   // 정지 시 0 트위스트 1회
}
function teleopSet(topic, lin, ang) {
  teleopStop();   // 이전 퍼블리셔 정리(0 발행 없이)
  const yaml = twistYaml(lin, ang);
  const cmd = VER === '2'
    ? `ros2 topic pub -r 10 ${shq(topic)} geometry_msgs/msg/Twist ${shq(yaml)} 2>&1`
    : `rostopic pub -r 10 ${shq(topic)} geometry_msgs/Twist ${shq(yaml)} 2>&1`;
  teleopId = spawnJob(`teleop ${topic}`, cmd).id;
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
    if (p === '/api/ver') return json(res, 200, { ver: VER });
    if (p === '/api/preflight') return json(res, 200, { checks: loadPreflight() });

    // 스트림
    if (p === '/events') return streamLines(res, 'python3 -', telemScript());
    if (p === '/echo') return q.get('topic') ? streamBlocks(res, echoFullCmd(VER, q.get('topic'))) : json(res, 400, { error: 'topic' });
    if (p === '/imgstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, `python3 ${shq(process.env.RDASH_IMG_BRIDGE || IMG_BRIDGE)} ${shq(t)} 2>/dev/null`); }
    if (p === '/cloudstream') { const t = q.get('topic'); if (!t) return json(res, 400, { error: 'topic' }); return streamLines(res, `python3 ${shq(process.env.RDASH_CLOUD_BRIDGE || CLOUD_BRIDGE)} ${shq(t)} 2>/dev/null`); }
    if (p === '/rosout') return streamBlocks(res, VER === '2' ? 'stdbuf -oL ros2 topic echo /rosout 2>/dev/null' : 'stdbuf -oL rostopic echo /rosout 2>/dev/null');
    if (p === '/diagnostics') return streamBlocks(res, VER === '2' ? 'stdbuf -oL ros2 topic echo /diagnostics 2>/dev/null' : 'stdbuf -oL rostopic echo /diagnostics 2>/dev/null');

    // 조회(one-shot)
    if (p === '/api/msgdef') return json(res, 200, { out: await runOnce(msgDefCmd(VER, q.get('type'))) });
    if (p === '/api/proto') {   // 발행 폼 프리필: 타입 스켈레톤 → flow-style YAML 한 줄 (TUI 와 동일)
      const cmd = protoCmd(VER, 'topic', q.get('name'), q.get('type'));
      if (!cmd) return json(res, 200, { yaml: '{}' });
      try { const skel = JSON.parse((await runOnce(cmd)).trim() || '{}').skel || {}; return json(res, 200, { yaml: buildYaml(flattenSkeleton(skel)) || '{}' }); }
      catch { return json(res, 200, { yaml: '{}' }); }
    }
    if (p === '/api/connections') return json(res, 200, { out: await runOnce(connectionsCmd(VER, q.get('kind'), q.get('name'))) });
    if (p === '/api/resource') { const b = await readBody(req); return json(res, 200, { out: await runOnce(resourceCmd(b.nodes || [])) }); }
    if (p === '/api/tftree') return json(res, 200, { out: await runOnce(tfTreeCmd(VER)) });
    if (p === '/api/tfecho') return json(res, 200, { out: await runOnce(tfEchoCmd(VER, q.get('src'), q.get('tgt'))) });
    if (p === '/api/bagcompare') return json(res, 200, { out: await runOnce(bagCompareCmd(VER, q.get('a'), q.get('b'))) });
    if (p === '/api/param/list') return json(res, 200, { rows: (await runOnce(paramListCmd(q.get('node')))).split('\n').filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { name: i < 0 ? l : l.slice(0, i), value: (i < 0 ? '' : l.slice(i + 1)).trim() }; }) });

    // 액션(POST)
    if (p === '/api/run' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(`${b.cmd} 2>&1`) }); }
    if (p === '/api/param/set' && post) { const b = await readBody(req); await runOnce(paramSetCmd(b.node, b.name, b.value)); return json(res, 200, { value: (await runOnce(paramGetCmd(b.node, b.name))).trim() }); }
    if (p === '/api/publish' && post) { const b = await readBody(req); const a = actionFor(VER, 'topic', b.name, b.msg); return json(res, 200, { out: a && a.cmd ? await runOnce(a.cmd) : '(no cmd)' }); }
    if (p === '/api/service' && post) { const b = await readBody(req); const a = actionFor(VER, 'service', b.name, b.req); return json(res, 200, { out: a && a.cmd ? await runOnce(a.cmd) : '(no cmd)' }); }
    if (p === '/api/setparam1' && post) { const b = await readBody(req); const a = actionFor(VER, 'param', b.name, b.value); return json(res, 200, { out: a && a.cmd ? await runOnce(a.cmd) : '(ROS2: per-node)' }); }
    if (p === '/api/killnode' && post) { const b = await readBody(req); const a = actionFor(VER, 'node', b.name); return json(res, 200, { out: a && a.cmd ? await runOnce(a.cmd) : '(no cmd)' }); }
    if (p === '/api/restart' && post) { const b = await readBody(req); const a = restartFor('node', b.name); return json(res, 200, { out: a && a.cmd ? await runOnce(a.cmd) : '(no cmd)' }); }
    if (p === '/api/lifecycle' && post) { const b = await readBody(req); return json(res, 200, { out: await runOnce(`ros2 lifecycle set '${b.node}' ${b.transition} 2>&1`) }); }

    // 잡
    if (p === '/api/jobs' && !post) return json(res, 200, { jobs: [...jobs.values()].map(jobView) });
    if (p === '/api/job' && post) { const b = await readBody(req); const r = spawnJob(b.label || b.cmd, b.cmd); return json(res, 200, jobView(r)); }
    if (p === '/api/action' && post) { const b = await readBody(req); const r = spawnJob(`action ${b.name}`, `ros2 action send_goal '${b.name}' '${b.type}' '${b.goal}' --feedback 2>&1`); return json(res, 200, jobView(r)); }
    if (p === '/api/teleop' && post) { const b = await readBody(req); const topic = b.topic || '/cmd_vel'; if (b.stop) teleopStop(topic); else teleopSet(topic, Number(b.lin) || 0, Number(b.ang) || 0); return json(res, 200, { ok: true }); }
    if (p === '/api/record' && post) { const b = await readBody(req); const out = `rdash_rec_${Date.now()}`; const r = spawnJob(`rosbag rec → ${out}`, bagRecordCmd(VER, b.topics && b.topics.length ? b.topics : null, out)); return json(res, 200, jobView(r)); }
    if (p === '/api/play' && post) { const b = await readBody(req); const r = spawnJob(`rosbag play ${b.path}`, bagPlayCmd(VER, b.path)); return json(res, 200, jobView(r)); }
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
function cleanup() { for (const r of jobs.values()) { try { process.kill(-r.child.pid, 'SIGTERM'); } catch { /* */ } } }
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(0); });

server.listen(PORT, () => { console.log(`RDash web (ROS${VER}) → http://localhost:${PORT}`); });
