// 명령 북마크 — 개발자가 자주 쓰는 셸 명령을 이름 붙여 저장하고 단축키로 실행.
// ~/.rdashrc (JSON) 에 컨테이너별로 영속화. 형식: { "preset": "px4", "presets": { "px4": [...], "turtlesim": [...] } }
// 구버전(프리셋 없는 평평한 { "bookmarks": [...] }) 파일도 그대로 로드/저장된다.
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

export function loadRc() {
  try {
    return JSON.parse(readFileSync(RC_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function presetNames(rc = loadRc()) {
  return Object.keys(rc.presets || {});
}

// rc.preset 이 유효하면 그대로, 아니면 첫 프리셋, presets 자체가 없으면(구버전) null.
export function activePreset(rc = loadRc()) {
  const names = presetNames(rc);
  if (names.includes(rc.preset)) return rc.preset;
  return names[0] || null;
}

export function loadBookmarks(preset = activePreset()) {
  const rc = loadRc();
  const bookmarks = preset ? rc.presets?.[preset] : rc.bookmarks;
  return Array.isArray(bookmarks) ? bookmarks : [];
}

export function saveBookmarks(bookmarks, preset) {
  try {
    const rc = loadRc();
    if (preset) {
      rc.preset = preset;
      rc.presets = { ...rc.presets, [preset]: bookmarks };
    } else {
      rc.bookmarks = bookmarks;
    }
    writeFileSync(RC_PATH, JSON.stringify(rc, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function savePreset(name) {
  try {
    const rc = loadRc();
    if (!rc.presets?.[name]) return false;
    rc.preset = name;
    writeFileSync(RC_PATH, JSON.stringify(rc, null, 2));
    return true;
  } catch {
    return false;
  }
}
