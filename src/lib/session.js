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
