#!/usr/bin/env node
// RDash — ROS 토픽/서비스/파라미터/노드 대시보드 TUI. 여기선 부트스트랩만; 로직은 src/ 하위 참조.
import { render } from 'ink';
import { MouseProvider } from '@zenobius/ink-mouse';
import { h } from './src/react.js';
import { StoreProvider } from './src/store.js';
import { Layout } from './src/components/Layout.js';
import { enterAltScreen, bindExit } from './src/lib/screen.js';
enterAltScreen();
bindExit(render(h(MouseProvider, null, h(StoreProvider, null, h(Layout)))).waitUntilExit());
