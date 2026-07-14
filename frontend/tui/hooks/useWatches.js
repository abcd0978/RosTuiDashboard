// 워치리스트 스트림 — 워치된 토픽들을 echo 로 구독해 각 필드의 최신 값을 맵으로 반환.
// (Watch 오버레이가 열려 있을 때만 마운트되므로, 볼 때만 구독한다.)
import { useState, useEffect } from '../react.js';
import { rosSpawn, echoCmd, fieldValue } from '../../../shared/ros.js';

export function useWatches(watches, ver) {
  const [vals, setVals] = useState({});
  const keys = watches.map((w) => `${w.topic}|${w.field}`).join(',');
  useEffect(() => {
    if (!watches.length) { setVals({}); return; }
    const topics = [...new Set(watches.map((w) => w.topic))];
    const latest = {};                       // topic → 최신 echo YAML 블록
    const children = topics.map((t) => {
      const child = rosSpawn(echoCmd(ver, t));
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n---\n');
        if (parts.length > 1) { latest[t] = parts[parts.length - 2]; buf = parts[parts.length - 1]; }
      });
      if (child.stderr) child.stderr.on('data', () => {});
      child.on('error', () => {});
      return child;
    });
    const timer = setInterval(() => {
      const out = {};
      for (const w of watches) {
        out[`${w.topic}|${w.field}`] = latest[w.topic] ? fieldValue(latest[w.topic], w.field) : undefined;
      }
      setVals(out);
    }, 300);
    return () => { clearInterval(timer); for (const c of children) { try { c.kill(); } catch { /* */ } } };
  }, [keys, ver]);
  return vals;
}
