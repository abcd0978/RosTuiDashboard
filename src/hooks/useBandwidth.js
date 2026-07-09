// 대역폭(bytes/s) — 선택한 토픽에 대해 rostopic/ros2 topic bw 스트림 파싱.
import { useState, useEffect } from '../react.js';
import { rosSpawn, bwCmd } from '../lib/ros.js';

export function useBandwidth(active, ver) {
  const [bw, setBw] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active || kind !== 'topic') { setBw(''); return; }
    let alive = true, buf = '';
    const child = rosSpawn(bwCmd(ver, name));
    setBw('…');
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const ln of lines) {
        const m = ln.match(/([\d.]+\s*[KMG]?B\/s)/);   // "1.23MB/s" (ROS1) / "1.23 MB/s" (ROS2)
        if (m && alive) setBw(m[1].replace(/\s+/g, ''));
      }
    });
    child.on('error', () => { if (alive) setBw(''); });
    return () => { alive = false; try { child.kill(); } catch { /* */ } };
  }, [kind, name, ver]);
  return bw;
}
