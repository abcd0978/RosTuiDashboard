// ROS 버전 — 이제 로컬에서 ros2/rostopic 존재를 spawn 으로 찔러보지 않고 백엔드가 판단한 값을 받는다.
// index.js 가 백엔드를 자식으로 띄우므로 시작 직후 몇 초는 응답이 없을 수 있어 waitForBackend 로 재시도한다.
import { useState, useEffect } from '../react.js';
import { waitForBackend } from '../lib/api.js';

export function useRosVersion() {
  const [ver, setVer] = useState(process.env.ROS_VER || null);
  useEffect(() => {
    if (ver) return;
    let alive = true;
    waitForBackend().then((v) => { if (alive) setVer(v || '1'); });
    return () => { alive = false; };
  }, []);
  return ver;
}