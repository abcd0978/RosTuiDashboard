// WebSocket 멀티플렉서(/ws) — 브라우저↔백엔드 단일 연결로 모든 스트림 다중화. 클라우드는 바이너리 프레임.
// 프레임: 텍스트 {"i":id,"d":line}  ·  바이너리 [uint32 id][uint32 mode][float32 xyzc...](클라우드).
import { WebSocketServer } from 'ws';
import { be } from './ros.js';
import { pipeLines, pipeBlocks, pipeCloud } from './http.js';
import { rbTelemetryCore, rbEchoOff } from './telemetry.js';

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
    bw: () => t && (child = pipeLines(be.bandwidth(t), txt)),   // 토픽 대역폭(rostopic bw) — 줄 단위

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
  // rosbridge 준비 여부로 게이트하지 않는다 — 예전엔 !ready 면 에러 한 줄만 보내고 구독을 등록하지
  // 않았고, 그래서 rosbridge 가 나중에 떠도 보낼 대상이 없어 그 클라이언트는 영구히 빈 화면이었다.
  // TUI 는 항상 이 경쟁에 걸렸다: 백엔드를 spawn 한 뒤 /api/ver(정적 라우트, 0.2초)만 보고 렌더를
  // 시작하는데 rosbridge(ros2 launch)는 수 초 걸린다. 웹은 사람이 나중에 페이지를 열어 안 걸렸다.
  //
  // 등록해두면 복구는 이미 되어 있다: telemTick 은 !rb.ready 동안 {nomaster:true} 를 보내고 준비되면
  // 실데이터로 넘어가며, rb.subscribe 는 준비 전 요청을 큐에 넣어 open 때 flush + 재연결 때 재구독한다.
  if (stream === 'events') off = rbTelemetryCore(txt);
  else if (stream === 'echo') { if (t) off = rbEchoOff(t, txt, params.type); }
  else if (map[stream]) map[stream]();
  return {
    off: () => { if (child) { try { child.kill(); } catch { /* */ } } if (off) { try { off(); } catch { /* */ } } },
    feed: (data) => { if (child && child.stdin && child.stdin.writable) { try { child.stdin.write(JSON.stringify(data) + '\n'); } catch { /* */ } } },
  };
}
