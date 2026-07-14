// 하단 — 전체 단축키 안내. (버튼은 제거, 키보드 중심.)
import { h } from '../../react.js';
import { Box, Text } from 'ink';

export function Footer() {
  return h(Box, null,
    h(Text, { dimColor: true }, ' ? = 전체 단축키 · 마우스 클릭/휠 지원'));
}
