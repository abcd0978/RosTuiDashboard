// ROS 버전 감지: ROS_VER env 우선, 없으면 ros2/rostopic 존재로 판단(둘 다면 ros2 우선).
import { useState, useEffect } from '../react.js';
import { rosSpawn } from '../../../shared/ros.js';

export function useRosVersion() {
  const [ver, setVer] = useState(process.env.ROS_VER || null);
  useEffect(() => {
    if (ver) return;
    const p = rosSpawn('command -v ros2 >/dev/null && echo 2 || echo 1');
    let o = '';
    p.stdout.on('data', (d) => { o += d.toString(); });
    p.on('close', () => setVer(o.trim() === '2' ? '2' : '1'));
    p.on('error', () => setVer('1'));
  }, []);
  return ver;
}
