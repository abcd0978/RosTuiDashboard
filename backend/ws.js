// WebSocket 멀티플렉서(/ws) — 브라우저↔백엔드 단일 연결로 모든 스트림 다중화. 클라우드는 바이너리 프레임.
// 프레임: 텍스트 {"i":id,"d":line}  ·  바이너리 [uint32 id][uint32 mode][float32 xyzc...](클라우드).
import { WebSocketServer } from 'ws';
import { be } from './ros.js';
import { pipeLines, pipeBlocks, pipeCloud } from './http.js';
import { useRb, rbTelemetryCore, rbEchoOff } from './telemetry.js';

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    else socket.destroy();
  });
  wss.on('connection', (ws) => {
    const subs = new Map();   // id → off()
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.op === 'sub') { if (subs.has(m.id)) return; subs.set(m.id, wsStart(ws, m)); }
      else if (m.op === 'unsub') { const s = subs.get(m.id); if (s) { s.off(); subs.delete(m.id); } }
      else if (m.op === 'feed') { const s = subs.get(m.id); if (s && s.feed) s.feed(m.data); }   // 브라우저→브리지 stdin(인터랙티브 마커 피드백)
    });
    ws.on('close', () => { for (const s of subs.values()) { try { s.off(); } catch { /* */ } } subs.clear(); });
  });
}
// 스트림 id 를 시작하고 정리 콜백을 돌려준다. SSE 라우트와 같은 백엔드 커맨드/헬퍼 재사용.
function wsStart(ws, m) {
  const { id, stream, params = {} } = m;
  const t = params.topic;
  const txt = (l) => { if (ws.readyState === 1) ws.send(JSON.stringify({ i: id, d: l })); };
  const bin = (payload) => {
    if (ws.readyState !== 1) return;
    const out = Buffer.allocUnsafe(4 + payload.length);
    out.writeUInt32LE(id, 0);
    payload.copy(out, 4);
    ws.send(out);
  };
  let child = null, off = null;
  const map = {
    rosout: () => (child = pipeBlocks(be.rosout(), txt)),
    diagnostics: () => (child = pipeBlocks(be.diagnostics(), txt)),
    markerstream: () => t && (child = pipeLines(be.markerBridge(t), txt)),
    tfstream: () => (child = pipeLines(be.tfDump(), txt)),
    geomstream: () => t && (child = pipeLines(be.geomBridge(t, params.type || ''), txt)),
    urdfstream: () => (child = pipeLines(be.urdfBridge(), txt)),
    annstream: () => t && (child = pipeLines(be.imgAnnBridge(t), txt)),
    caminfostream: () => t && (child = pipeLines(be.camInfoBridge(t), txt)),
    imgstream: () => t && (child = pipeLines(be.imgBridge(t), txt)),
    imstream: () => t && (child = pipeLines(be.imBridge(t), txt)),   // 인터랙티브 마커(양방향: feed→stdin)
    cloudstream: () => t && (child = pipeCloud(be.cloudBridge(t), bin)),
  };
  if (stream === 'events') { if (useRb()) off = rbTelemetryCore(txt); else txt(JSON.stringify({ error: `rosbridge unavailable: ${be.url}` })); }
  else if (stream === 'echo') { if (t) { if (useRb()) off = rbEchoOff(t, txt); else txt(JSON.stringify({ error: `rosbridge unavailable: ${be.url}` })); } }
  else if (map[stream]) map[stream]();
  return {
    off: () => { if (child) { try { child.kill(); } catch { /* */ } } if (off) { try { off(); } catch { /* */ } } },
    feed: (data) => { if (child && child.stdin && child.stdin.writable) { try { child.stdin.write(JSON.stringify(data) + '\n'); } catch { /* */ } } },
  };
}
