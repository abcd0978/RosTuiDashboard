// 기본 상태줄(오버레이 없을 때) — 마지막 액션 결과 / 활성 필터 / x 액션 힌트.
import { h } from '../react.js';
import { Text } from 'ink';
import { useDashboard } from '../store.js';

export function StatusLine() {
  const { filter, list, status, actHint } = useDashboard();
  if (filter) return h(Text, { color: 'cyan' }, ` 🔍 "${filter}" — ${list.length}건  (Esc 해제)`);
  return h(Text, { color: status ? 'cyan' : 'gray' },
    status ? ` ⚑ ${status}` : (actHint ? ` x = ${actHint}` : ''));
}
