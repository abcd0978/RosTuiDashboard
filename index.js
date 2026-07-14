#!/usr/bin/env node
// RDash — ROS 토픽/서비스/파라미터/노드 대시보드 TUI. 여기선 부트스트랩만; 로직은 frontend/tui/ 참조.
//
// TUI 는 더 이상 ROS 를 직접 만지지 않는다. 웹과 똑같이 백엔드 HTTP/WS API 의 클라이언트다(계약: API.md).
// 그래서 백엔드가 반드시 떠 있어야 하고, 여기서 자식으로 띄운 뒤 응답할 때까지 기다렸다가 렌더한다.
// ROS 와 어떻게 대화할지(cli/rcl/rosbridge)는 백엔드가 RDASH_BACKEND 로 혼자 정한다 — TUI 는 모른다.
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { render } from 'ink';
import { MouseProvider } from '@zenobius/ink-mouse';
import { h } from './frontend/tui/react.js';
import { StoreProvider } from './frontend/tui/store.js';
import { Layout } from './frontend/tui/components/chrome/Layout.js';
import { enterAltScreen, bindExit } from './frontend/tui/lib/screen.js';
import { createDiffStdout } from './frontend/tui/lib/diffstdout.js';
import { ensurePyDeps } from './frontend/tui/lib/pydeps.js';
import { API, waitForBackend } from './frontend/tui/lib/api.js';

// 마우스 이벤트 이미터에 버튼/스토어가 다수 구독 → 기본 상한(10)을 넘겨 MaxListenersExceededWarning 이
// 대체 화면 위로 새어 나오며 프레임을 망가뜨렸다. 0 = 무제한 → 경고 자체를 없앤다.
EventEmitter.defaultMaxListeners = 0;
try { process.stdin.setMaxListeners(0); process.stdout.setMaxListeners(0); } catch { /* */ }
// 그 외 Node 경고도 TUI 위에 찍히지 않도록 조용히 삼킨다(대체 화면 오염 방지).
process.on('warning', () => {});

ensurePyDeps();   // 파이썬 브리지가 쓰는 패키지 없으면 자동 설치 — 대체 화면 진입 전에.

// 백엔드 동반 기동 — `npm start` 하나로 TUI + 웹을 함께 띄운다. 백엔드는 TUI 의 데이터 소스이기도 하다.
// RDASH_API 로 외부(이미 떠 있는/원격) 백엔드를 지정하면 여기서 띄우지 않는다.
const spawnBackend = !process.env.RDASH_API;
if (spawnBackend) {
  const port = Number(process.env.RDASH_WEB_PORT) || 8080;
  process.env.RDASH_WEB_ACTIVE = `localhost:${port}`;   // EnvBar 표시용
  const here = dirname(fileURLToPath(import.meta.url));
  const env = { ...process.env };
  // 루프백 강제 — 모든 게 한 머신(도커 컨테이너 포함)에 있을 때 ROS1 이 호스트명 해석에 실패하는 걸 피한다.
  // 다른 머신의 ROS1 마스터/노드에 붙어야 하면 RDASH_LOOPBACK=0 으로 끄고 ROS_IP/ROS_HOSTNAME 을 직접 준다.
  if (process.env.RDASH_LOOPBACK !== '0') {
    env.ROS_IP = process.env.ROS_IP || '127.0.0.1';
    delete env.ROS_HOSTNAME;
  }
  const web = spawn(process.execPath, [...process.execArgv, join(here, 'backend', 'server.js')],
    { stdio: 'ignore', env });                          // stdio 를 삼켜 대체 화면 오염 방지
  web.on('error', () => { /* 아래 waitForBackend 가 잡는다 */ });
  const killWeb = () => { try { web.kill('SIGTERM'); } catch { /* */ } };
  process.on('exit', killWeb); process.on('SIGINT', killWeb); process.on('SIGTERM', killWeb);
}

// 백엔드가 응답할 때까지 대기 — 없으면 빈 TUI 를 영원히 그리는 대신 이유를 말하고 죽는다.
const ver = await waitForBackend(20000);
if (!ver) {
  console.error(`RDash: 백엔드에 연결하지 못했습니다 — ${API}`);
  console.error(spawnBackend
    ? '  백엔드를 띄우지 못했습니다. `node backend/server.js` 를 직접 실행해 오류를 확인하세요.'
    : '  RDASH_API 가 가리키는 백엔드가 떠 있는지 확인하세요.');
  process.exit(1);
}

enterAltScreen();
// 라인 차등 출력기로 감싼다 — pose 등 고빈도 갱신 시 바뀐 줄만 다시 그려 전체 재출력을 없앤다.
const stdout = (process.stdout.isTTY && process.env.RDASH_DIFF !== '0')
  ? createDiffStdout(process.stdout) : process.stdout;
bindExit(render(h(MouseProvider, null, h(StoreProvider, null, h(Layout))), { stdout }).waitUntilExit());
