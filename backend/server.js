// RDash 웹 서버 — TUI 와 같은 텔레메트리/명령 인프라를 재사용해 브라우저 UI 를 localhost 로 서빙.
// 목표: TUI 의 모든 기능을 웹에서도. 이 파일은 진입점일 뿐이고, 로직 빌더는 전부 shared/ 재사용.
// 앱 조립은 app.js, 텔레메트리는 telemetry.js, 잡/텔레옵은 jobs.js, echo 먹스는 ws.js 참조.
// 실행: node backend/server.js (npm run web) · 포트 RDASH_WEB_PORT(기본 8080)
import http from 'http';
import { VER } from './ros.js';
import { app } from './app.js';
import { attachWebSocket } from './ws.js';
import { jobs } from './jobs.js';

const PORT = Number(process.env.RDASH_WEB_PORT) || 8080;
// 바인딩 주소 — 기본 0.0.0.0(모든 인터페이스): 컨테이너 안에서 돌려도 -p 로 포트만 노출하면 호스트에서 접속 가능.
// 로컬 전용으로 잠그려면 RDASH_WEB_HOST=127.0.0.1.
const HOST = process.env.RDASH_WEB_HOST || '0.0.0.0';

// ── 라우팅 ────────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket 멀티플렉서(/ws) ──
attachWebSocket(server);

// 종료 시 잡 정리 — 잡은 백엔드가 소유하므로 백엔드가 죽으면 같이 내려간다.
// SIGINT 를 쓴다(SIGTERM 아님): roslaunch 는 SIGINT 를 받아야 자기 노드들을 정리하고, 노드는 그래야
// ROS 마스터에서 등록을 해제한다. 안 그러면 죽은 노드의 토픽이 마스터에 유령으로 남는다.
// 여기선 기다리지 않는다 — 잡은 detached 프로세스 그룹이라 우리가 죽어도 알아서 정리를 마친다.
function cleanup() {
  for (const r of jobs.values()) { try { process.kill(-r.child.pid, 'SIGINT'); } catch { /* */ } }
}
process.on('exit', cleanup);

// SIGTERM 을 반드시 직접 처리해야 한다.
// Node 는 SIGTERM 리스너가 하나라도 등록되면 "기본 종료" 동작을 포기한다. backend/ros.js 가
// rosbridge 를 정리하려고 process.on('SIGTERM', killRb) 를 걸어 두는데, 그것 때문에 백엔드가
// SIGTERM 으로는 죽지 않는 프로세스가 돼 있었다 → index.js 가 종료하며 보내는 SIGTERM 이 먹히지
// 않아 cleanup 이 아예 안 돌고, 잡(시뮬레이션 등)이 고아로 남았다. 실제로 그렇게 당했다.
const bye = () => process.exit(0);   // 정리는 위의 'exit' 핸들러들이 한다(ros.js 의 killRb 포함)
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

server.listen(PORT, HOST, () => {
  console.log(`RDash web (ROS${VER}) — ${HOST}:${PORT} 리스닝`);
  console.log(`  로컬:  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  호스트/원격: http://<컨테이너-또는-호스트-IP>:${PORT}  (컨테이너면 docker -p ${PORT}:${PORT} 또는 --network host 필요)`);
});