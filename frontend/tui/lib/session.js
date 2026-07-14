// 세션 상태 유지 — 펼친 폴더·워치·모드·마지막 선택을 ~/.rdash_session.json 에 저장/복원.
// 재시작해도 보던 자리로 돌아오게. (실패해도 조용히 기본값)
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const SESSION_PATH = join(homedir(), '.rdash_session.json');

export function loadSession() {
  try { const o = JSON.parse(readFileSync(SESSION_PATH, 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch { return {}; }
}
export function saveSession(s) {
  try { writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2)); } catch { /* */ }
}

// 명령 히스토리 — 실행한 셸 명령을 ~/.rdash_history 에 누적(중복 제거, 최근 200개). 북마크 에디터에서 Ctrl+P/N.
export const HISTORY_PATH = join(homedir(), '.rdash_history');
export function loadHistory() {
  try { const a = JSON.parse(readFileSync(HISTORY_PATH, 'utf8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
export function pushHistory(cmd) {
  const c = (cmd || '').trim();
  if (!c) return loadHistory();
  const a = loadHistory().filter((x) => x !== c);
  a.push(c);
  const t = a.slice(-200);
  try { writeFileSync(HISTORY_PATH, JSON.stringify(t)); } catch { /* */ }
  return t;
}
