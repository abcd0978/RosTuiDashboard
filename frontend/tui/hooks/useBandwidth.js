// 대역폭(bytes/s) — rostopic bw 스폰 대신 bw 스트림 구독(페이로드는 이미 평문 한 줄).
import { useState, useEffect } from '../react.js';
import { openStream } from '../lib/api.js';

export function useBandwidth(active, ver) {
  const [bw, setBw] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active || kind !== 'topic') { setBw(''); return; }
    let alive = true;
    setBw('…');
    const unsub = openStream('bw', { topic: name }, (line) => {
      const m = line.match(/([\d.]+\s*[KMG]?B\/s)/);   // "1.23MB/s" (ROS1) / "1.23 MB/s" (ROS2)
      if (m && alive) setBw(m[1].replace(/\s+/g, ''));
    });
    return () => { alive = false; unsub(); };
  }, [kind, name, ver]);
  return bw;
}