// ROS_DOMAIN_ID 전환 입력 — domainEdit 모드에서만 마운트. 다른 컨테이너/도메인 그래프 보기.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';

export function DomainEdit() {
  const d = useDashboard();
  useInput((ch, key) => {
    if (key.return) { d.submitDomain(d.domainEdit.value); d.setDomainEdit(null); }
    else if (key.escape) d.setDomainEdit(null);
    else if (key.backspace || key.delete) d.setDomainEdit((e) => e && ({ ...e, value: e.value.slice(0, -1) }));
    else if (ch && /[0-9]/.test(ch)) d.setDomainEdit((e) => e && ({ ...e, value: (e.value + ch).slice(0, 3) }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, null,
    h(Text, { color: 'yellow' }, ' ROS_DOMAIN_ID = '),
    h(Text, { backgroundColor: 'yellow', color: 'black' }, `${d.domainEdit.value || ''} `),
    h(Text, { dimColor: true }, '  Enter=전환(재연결) Esc=취소  (빈값=해제)'));
}
