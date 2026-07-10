// 명령 북마크 — 개발자가 자주 쓰는 셸 명령을 이름 붙여 저장하고 단축키로 실행.
// ~/.rdashrc (JSON) 에 컨테이너별로 영속화. 형식: { "bookmarks": [ {name, cmd, key} ] }
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const RC_PATH = join(homedir(), '.rdashrc');

// 북마크 추가창에서 ↑↓ 로 고를 흔한 명령 템플릿(<...> 부분만 채워 쓰면 됨).
export const BOOKMARK_TEMPLATES = [
  'ros2 launch <pkg> <file>.launch.py',
  'ros2 run <pkg> <exe>',
  'ros2 bag record -a',
  'ros2 bag record /topic1 /topic2',
  'MicroXRCEAgent udp4 -p 8888',
  'ros2 daemon stop && ros2 daemon start',
  'rqt_graph',
  'ros2 topic hz <topic>',
];

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
