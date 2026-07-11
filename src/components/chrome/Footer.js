// 하단 — 긴 키 나열 대신 마우스로 누를 수 있는 핵심 버튼들 + "? 로 전체 단축키" 안내.
import { h } from '../../react.js';
import { Box, Text } from 'ink';
import { useDashboard } from '../../store.js';
import { Button } from '../common/Button.js';

export function Footer() {
  const d = useDashboard();
  return h(Box, null,
    h(Button, { label: '? Help', onPress: () => d.setHelp(true), color: 'cyan' }),
    h(Button, { label: '/ Find', onPress: () => d.setSearching(true), color: 'yellow' }),
    h(Button, { label: '⚙ Jobs', onPress: () => d.setJobsOpen({ idx: 0 }), color: 'blue' }),
    h(Button, { label: d.treeHidden ? '⇔ Tree' : '⇔ Wide', onPress: () => d.toggleTree(), color: 'green' }),
    h(Button, { label: '✕ Quit', onPress: () => d.quit(), color: 'red' }),
    h(Text, { dimColor: true }, '   ? = 전체 단축키 · 마우스 클릭/휠 지원'));
}
