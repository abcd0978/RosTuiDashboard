#!/usr/bin/env node
// RDash — ROS 토픽/서비스/파라미터/노드 대시보드 TUI. 여기선 부트스트랩만; 로직은 src/ 하위 참조.
import { EventEmitter } from 'events';
import { render } from 'ink';
import { MouseProvider } from '@zenobius/ink-mouse';
import { h } from './src/react.js';
import { StoreProvider } from './src/store.js';
import { Layout } from './src/components/Layout.js';
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
enterAltScreen();
// 라인 차등 출력기로 감싼다 — pose 등 고빈도 갱신 시 바뀐 줄만 다시 그려 전체 재출력을 없앤다.
const stdout = (process.stdout.isTTY && process.env.RDASH_DIFF !== '0')
  ? createDiffStdout(process.stdout) : process.stdout;
bindExit(render(h(MouseProvider, null, h(StoreProvider, null, h(Layout))), { stdout }).waitUntilExit());
