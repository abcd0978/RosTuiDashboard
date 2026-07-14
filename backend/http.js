// HTTP 스트림 헬퍼 · 프로세스→스트림 파이프 · 정적 파일 루트. json/readBody/serveFile 은 Express 가 대신한다.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rosSpawn } from '../shared/ros.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 유틸 ──────────────────────────────────────────────────────────────────
export function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('\n');
  return (data) => res.write(`data: ${data}\n\n`);
}
export function runOnce(cmd) {
  return new Promise((resolve) => {
    const p = rosSpawn(`${cmd}`);
    let out = '';
    if (p.stderr) p.stderr.on('data', (d) => { out += d.toString(); });
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', () => resolve(out));
    p.on('error', () => resolve(out || '(exec error)'));
  });
}

// ── 스트림(SSE) ───────────────────────────────────────────────────────────
// ── send-기반 파이프 헬퍼(전송계층 무관: SSE/WS 공용) ──
export function pipeLines(cmd, send, writeScript) {
  const child = rosSpawn(cmd);
  if (writeScript) {
    child.stdin.on('error', () => {});
    child.stdin.write(writeScript);
    child.stdin.end();
  }
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) send(l);
    }
  });
  if (child.stderr) child.stderr.on('data', () => {});
  return child;
}
export function pipeBlocks(cmd, send) {   // '---' 구분 블록(echo/diagnostics)
  const child = rosSpawn(cmd);
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const parts = buf.split('\n---\n');
    while (parts.length > 1) {
      const b = parts.shift().trimEnd();
      if (b) send(JSON.stringify(b));
    }
    buf = parts[0];
  });
  if (child.stderr) child.stderr.on('data', () => {});
  return child;
}
// 클라우드 바이너리 프레임 리더: [uint32 LE len][payload=mode(4)+float32...]. base64 없이 그대로 흘림(최속).
export function pipeCloud(cmd, sendBin) {
  const child = rosSpawn(cmd);
  let buf = Buffer.alloc(0);
  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      sendBin(buf.subarray(4, 4 + len));
      buf = buf.subarray(4 + len);
    }
  });
  if (child.stderr) child.stderr.on('data', () => {});
  return child;
}
export function streamLines(res, cmd, writeScript) {
  const send = sse(res);
  const child = pipeLines(cmd, send, writeScript);
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}
export function streamBlocks(res, cmd) {
  const send = sse(res);
  const child = pipeBlocks(cmd, send);
  res.on('close', () => { try { child.kill(); } catch { /* */ } });
}

// ── 정적 파일 루트 — 브라우저 코드는 frontend/web/ 아래(app.js 에서 express.static 으로 마운트) ──
export const WEB = join(HERE, '..', 'frontend', 'web');