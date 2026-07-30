// 워크스페이스 오버레이 — rosSpawn(shared/ros.js)은 비로그인 셸이라 ~/.bashrc 를 안 읽고,
// 백엔드를 띄운 프로세스의 env 를 그대로 물려받을 뿐이다. 그 env 가 distro(/opt/ros/*/setup.bash)만
// 소싱돼 있으면, custom action/msg 타입(예: mini_mission_interfaces)이 있는 워크스페이스는 영원히
// 안 보인다 — `ros2 action list -t` 는 DDS 그래프에서 타입 "이름"만 문자열로 읽어 오버레이 없이도
// 나오지만(검증됨), goal 전송/직렬화는 그 타입의 파이썬 모듈이 import 돼야 해서 오버레이가 꼭 필요하다.
// 이 파일은 사용자가 켤 오버레이 목록을 고르고(discoverOverlays) 영속화(load/saveOverlays)하고,
// 매 명령 앞에 붙일 소싱 문자열(sourcePrelude)을 만드는 것만 한다 — spawn 은 shared/ros.js 가 한다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { shq } from './util.js';

const FILE = join(homedir(), '.rdash_overlays.json');   // shared/baseline.js 와 같은 저장 방식

export function loadOverlays() {
  try {
    const v = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}

export function saveOverlays(list) {
  try { writeFileSync(FILE, JSON.stringify(list)); return true; } catch { return false; }
}

// 후보 오버레이 탐색 — 실제로 디스크에 있는 setup.bash 만 반환(존재 확인 완료, 중복 제거, 정렬).
//   · COLCON_PREFIX_PATH(콜론 구분) — colcon 이 이미 아는 prefix 들
//   · $HOME 바로 아래 한 단계 — <ws>/install/setup.bash(colcon/ROS2), <ws>/devel/setup.bash(catkin/ROS1)
export function discoverOverlays() {
  const out = new Set();
  for (const p of (process.env.COLCON_PREFIX_PATH || '').split(':').filter(Boolean)) {
    const sb = join(p, 'setup.bash');
    if (existsSync(sb)) out.add(sb);
  }
  let entries = [];
  try { entries = readdirSync(homedir(), { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    for (const sb of [join(homedir(), e.name, 'install', 'setup.bash'), join(homedir(), e.name, 'devel', 'setup.bash')]) {
      if (existsSync(sb)) out.add(sb);
    }
  }
  return [...out].sort();
}

// rosSpawn 이 모든 명령 앞에 붙이는 프리앰블 — distro 먼저(기본값), 켜진 오버레이는 뒤(나중 소싱이 이김).
// 오버레이 하나하나에 2>/dev/null 을 달아, 삭제된/오타난 경로 하나가 명령 전체를 깨지 않게 한다.
export function sourcePrelude() {
  const parts = [`source /opt/ros/*/setup.bash 2>/dev/null`];
  for (const ov of loadOverlays()) parts.push(`source ${shq(ov)} 2>/dev/null`);
  return parts.join('; ') + '; ';
}
