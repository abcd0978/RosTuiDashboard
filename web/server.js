// RDash 웹 서버 — TUI 와 같은 텔레메트리/명령 인프라를 재사용해 브라우저 UI 를 localhost 로 서빙한다.
// 시각화(노드 위상 그래프·플롯)는 터미널보다 웹 GUI 가 낫기 때문. TUI 는 그대로 두고 이건 추가 진입점.
//   실행:  node web/server.js   (또는 npm run web)   ·  포트: RDASH_WEB_PORT (기본 8080)
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { rosSpawn, echoFullCmd } from '../src/lib/ros.js';
import { TELEM, TELEM2 } from '../src/lib/paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.RDASH_WEB_PORT) || 8080;

function detectVer() {
  if (process.env.ROS_VER) return process.env.ROS_VER;
  const r = spawnSync('bash', ['-lc', 'command -v ros2 >/dev/null 2>&1']);
  return r.status === 0 ? '2' : '1';
}
const VER = detectVer();

// SSE 헬퍼 — 자식 프로세스 stdout 을 줄/블록 단위로 클라이언트에 흘린다.
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*',
  });
  res.write('\n');
  return (data) => res.write(`data: ${data}\n\n`);
}

// 텔레메트리 스크립트 — RDASH_TELEM 파일이 있으면 그것(테스트/커스텀), 없으면 TUI 와 동일한 내장 스크립트.
function telemScript() {
  if (process.env.RDASH_TELEM) { try { return readFileSync(process.env.RDASH_TELEM, 'utf8'); } catch { /* */ } }
  return VER === '2' ? TELEM2 : TELEM;
}

// 텔레메트리 스트림 — telemetry(.py) 를 python3 로 실행, JSON 한 줄씩 그대로 전달.
function streamTelemetry(res) {
  const send = sse(res);
  const child = rosSpawn('python3 -');
  child.stdin.on('error', () => {});
  child.stdin.write(telemScript()); child.stdin.end();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) send(line); }
  });
  if (child.stderr) child.stderr.on('data', () => {});
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}

// 토픽 echo 스트림 — YAML 블록(---)마다 한 이벤트로.
function streamEcho(res, topic) {
  const send = sse(res);
  const child = rosSpawn(echoFullCmd(VER, topic));
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString(); const parts = buf.split('\n---\n');
    while (parts.length > 1) { const b = parts.shift().trimEnd(); if (b) send(JSON.stringify(b)); }
    buf = parts[0];
  });
  if (child.stderr) child.stderr.on('data', () => {});
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}

const PAGE = readFileSync(join(HERE, 'index.html'), 'utf8');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return;
  }
  if (url.pathname === '/api/ver') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ver: VER })); return; }
  if (url.pathname === '/events') { streamTelemetry(res); return; }
  if (url.pathname === '/echo') {
    const t = url.searchParams.get('topic');
    if (!t) { res.writeHead(400); res.end('topic required'); return; }
    streamEcho(res, t); return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RDash web (ROS${VER}) → http://localhost:${PORT}`);
});
