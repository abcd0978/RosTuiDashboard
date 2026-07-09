// 하단 키 힌트 + 마우스 Quit 버튼.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { Button } from './Button.js';

export function Footer() {
  const { quit } = useDashboard();
  return h(Box, null,
    h(Text, { dimColor: true }, ` ↑↓ move | Enter | / search | p plot | x act | b bookmarks | h Hz | D domain | q quit `),
    h(Button, { label: '✕ Quit', onPress: quit }));
}
