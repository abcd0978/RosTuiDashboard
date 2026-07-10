// '/' 퍼지 검색 입력줄 — searching 모드에서만 마운트되어 키 입력을 자기 책임에서 처리.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { typable } from '../lib/util.js';

export function SearchBar() {
  const d = useDashboard();
  useInput((ch, key) => {
    if (key.return) d.setSearching(false);               // 필터 유지하고 닫기
    else if (key.escape) { d.setSearching(false); d.setFilter(''); }
    else if (key.backspace || key.delete) d.setFilter((f) => f.slice(0, -1));
    else if (typable(ch, key)) d.setFilter((f) => f + ch);
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, ' 🔍 '),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.filter} `),
    h(Text, { dimColor: true }, `  Enter=적용 Esc=취소  (${d.list.length}건)`));
}
