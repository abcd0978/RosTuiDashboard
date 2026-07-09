// 명령 북마크 — 개발자가 자주 쓰는 셸 명령을 이름 붙여 저장하고 단축키로 실행.
// ~/.rdashrc (JSON) 에 컨테이너별로 영속화. 형식: { "bookmarks": [ {name, cmd, key} ] }
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const RC_PATH = join(homedir(), '.rdashrc');

export function loadBookmarks() {
  try {
    const d = JSON.parse(readFileSync(RC_PATH, 'utf8'));
    return Array.isArray(d.bookmarks) ? d.bookmarks : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(bookmarks) {
  try {
    writeFileSync(RC_PATH, JSON.stringify({ bookmarks }, null, 2));
    return true;
  } catch {
    return false;
  }
}
