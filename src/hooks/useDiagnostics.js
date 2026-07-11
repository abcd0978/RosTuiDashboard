// /diagnostics(diagnostic_msgs/DiagnosticArray) 스트림 → { name: {level, message} }.
// level: 0=OK 1=WARN 2=ERROR 3=STALE. 진단뷰가 열렸을 때만 마운트(active=true).
import { useState, useEffect, useRef } from '../react.js';
import { rosSpawn } from '../lib/ros.js';

export function useDiagnostics(active, ver) {
  const [map, setMap] = useState({});
  const mapRef = useRef({});
  useEffect(() => {
    if (!active) return undefined;
    mapRef.current = {};
    let alive = true, buf = '', pending = false;
    const cmd = ver === '2'
      ? 'stdbuf -oL ros2 topic echo /diagnostics 2>/dev/null'
      : 'stdbuf -oL rostopic echo /diagnostics 2>/dev/null';
    const child = rosSpawn(cmd);
    const flush = () => { pending = false; if (alive) setMap({ ...mapRef.current }); };
    if (child.stdout) child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n---\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 5);
        const si = block.indexOf('status:');
        const sblock = si >= 0 ? block.slice(si) : block;
        for (const part of sblock.split(/\n\s*- /).slice(1)) {
          const lv = /level:\s*(\d+)/.exec(part);
          const nm = /name:\s*["']?(.*)/.exec(part);
          const ms = /message:\s*["']?(.*)/.exec(part);
          const name = nm ? nm[1].replace(/["']\s*$/, '').trim() : '?';
          mapRef.current[name] = { level: lv ? +lv[1] : 0, message: ms ? ms[1].replace(/["']\s*$/, '').trim() : '' };
        }
      }
      if (!pending) { pending = true; setTimeout(flush, 150); }
    });
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', () => {});
    return () => { alive = false; try { child.kill(); } catch { /* */ } };
  }, [active, ver]);
  return map;
}
