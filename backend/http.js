// HTTP 응답 헬퍼 · 프로세스→스트림 파이프 · 정적 파일 서빙.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname, resolve } from 'path';
import { rosSpawn } from '../shared/ros.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 유틸 ──────────────────────────────────────────────────────────────────
export function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('\n');
  return (data) => res.write(`data: ${data}\n\n`);
}
export function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
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
export function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
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

// ── 정적 파일 — 브라우저 코드는 frontend/web/ 아래(모듈로 쪼개져 있어 하위 경로까지 그대로 서빙) ──
export const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
export const WEB = join(HERE, '..', 'frontend', 'web');
export function serveFile(res, name) {
  const file = resolve(WEB, '.' + (name.startsWith('/') ? name : '/' + name));
  if (!file.startsWith(WEB)) {   // 경로 탈출 차단
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}
