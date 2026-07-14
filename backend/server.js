// RDash 웹 서버 — TUI 와 같은 텔레메트리/명령 인프라를 재사용해 브라우저 UI 를 localhost 로 서빙.
// 목표: TUI 의 모든 기능을 웹에서도. 이 파일은 진입점일 뿐이고, 로직 빌더는 전부 shared/ 재사용.
// 라우팅은 routes.js, 텔레메트리는 telemetry.js, 잡/텔레옵은 jobs.js, echo 먹스는 mux.js 참조.
// 실행: node backend/server.js (npm run web) · 포트 RDASH_WEB_PORT(기본 8080)
import http from 'http';
import { VER } from './ros.js';
import { router } from './routes.js';
import { attachWebSocket } from './ws.js';
import { jobs } from './jobs.js';

const PORT = Number(process.env.RDASH_WEB_PORT) || 8080;
// 바인딩 주소 — 기본 0.0.0.0(모든 인터페이스): 컨테이너 안에서 돌려도 -p 로 포트만 노출하면 호스트에서 접속 가능.
// 로컬 전용으로 잠그려면 RDASH_WEB_HOST=127.0.0.1.
const HOST = process.env.RDASH_WEB_HOST || '0.0.0.0';

// ── 라우팅 ────────────────────────────────────────────────────────────────
const server = http.createServer(router);

// ── WebSocket 멀티플렉서(/ws) ──
attachWebSocket(server);

// 종료 시 잡 정리
function cleanup() {
  for (const r of jobs.values()) { try { process.kill(-r.child.pid, 'SIGTERM'); } catch { /* */ } }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });

server.listen(PORT, HOST, () => {
  console.log(`RDash web (ROS${VER}) — ${HOST}:${PORT} 리스닝`);
  console.log(`  로컬:  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  호스트/원격: http://<컨테이너-또는-호스트-IP>:${PORT}  (컨테이너면 docker -p ${PORT}:${PORT} 또는 --network host 필요)`);
});
