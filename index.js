#!/usr/bin/env node
// RDash — ROS 토픽/서비스/파라미터/노드 대시보드 TUI. 여기선 부트스트랩만; 로직은 src/ 하위 참조.
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { render } from 'ink';
import { MouseProvider } from '@zenobius/ink-mouse';
import { h } from './src/react.js';
import { StoreProvider } from './src/store.js';
import { Layout } from './src/components/chrome/Layout.js';
import { enterAltScreen, bindExit } from './src/lib/screen.js';
import { createDiffStdout } from './src/lib/diffstdout.js';
import { ensurePyDeps } from './src/lib/pydeps.js';

// 마우스 이벤트 이미터에 버튼/스토어가 다수 구독 → 기본 상한(10)을 넘겨 MaxListenersExceededWarning 이
// 대체 화면 위로 새어 나오며 프레임을 망가뜨렸다. 0 = 무제한 → 경고 자체를 없앤다.
EventEmitter.defaultMaxListeners = 0;
try { process.stdin.setMaxListeners(0); process.stdout.setMaxListeners(0); } catch { /* */ }
// 그 외 Node 경고도 TUI 위에 찍히지 않도록 조용히 삼킨다(대체 화면 오염 방지).
process.on('warning', () => {});

ensurePyDeps();   // 플롯용 파이썬 패키지(numpy·matplotlib·PyYAML) 없으면 자동 설치 — 대체 화면 진입 전에.

// 웹 서버 동반 기동 — `npm start` 하나로 TUI + localhost 웹을 함께 띄운다.
// 웹은 stdio 를 삼켜(대체 화면 오염 방지) 조용히 돌고, TUI 종료 시 함께 정리된다. RDASH_NO_WEB=1 로 끌 수 있다.
if (process.env.RDASH_NO_WEB !== '1') {
  const port = Number(process.env.RDASH_WEB_PORT) || 8080;
  process.env.RDASH_WEB_ACTIVE = `localhost:${port}`;   // EnvBar 표시용
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const web = spawn(process.execPath, [join(here, 'web', 'server.js')],
      { stdio: 'ignore', env: process.env });
    web.on('error', () => { delete process.env.RDASH_WEB_ACTIVE; });
    const killWeb = () => { try { web.kill('SIGTERM'); } catch { /* */ } };
    process.on('exit', killWeb); process.on('SIGINT', killWeb); process.on('SIGTERM', killWeb);
  } catch { delete process.env.RDASH_WEB_ACTIVE; }   // 웹 없이도 TUI 는 진행
}

enterAltScreen();
// 라인 차등 출력기로 감싼다 — pose 등 고빈도 갱신 시 바뀐 줄만 다시 그려 전체 재출력을 없앤다.
const stdout = (process.stdout.isTTY && process.env.RDASH_DIFF !== '0')
  ? createDiffStdout(process.stdout) : process.stdout;
bindExit(render(h(MouseProvider, null, h(StoreProvider, null, h(Layout))), { stdout }).waitUntilExit());
