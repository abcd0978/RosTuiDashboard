// 하단 키 힌트 + 마우스 Quit 버튼.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { Button } from './Button.js';

export function Footer() {
  const { quit } = useDashboard();
  return h(Box, null,
    h(Text, { dimColor: true }, ` ↑↓ move | Enter open | / search | p plot | x action | r restart | space freeze | q quit `),
    h(Button, { label: '✕ Quit', onPress: quit }));
}
