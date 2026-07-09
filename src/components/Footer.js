// 하단 키 힌트 + 마우스 Quit 버튼.
import { h } from '../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../store.js';
import { Button } from './Button.js';

export function Footer() {
  const { quit } = useDashboard();
  return h(Box, null,
    h(Text, { dimColor: true }, ` move | Enter | / find | p plot | x act | c conn | t tf | S res | R rec | b marks | h Hz | q quit `),
    h(Button, { label: '✕ Quit', onPress: quit }));
}
