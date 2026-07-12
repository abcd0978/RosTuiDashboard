// /rosout 로그 스트림 → [{level, name, msg}] 링버퍼. 로그뷰가 열렸을 때만 마운트(active=true).
// echo YAML 블록(--- 구분)에서 level(정수)·name·msg 만 뽑는다.
import { useState, useEffect, useRef } from '../react.js';
import { rosSpawn } from '../lib/ros.js';

export function useRosout(active, ver) {
  const [lines, setLines] = useState([]);
  const bufRef = useRef([]);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true, buf = '', pending = false;
    const cmd = ver === '2'
      ? 'stdbuf -oL ros2 topic echo /rosout 2>/dev/null'
      : 'stdbuf -oL rostopic echo /rosout 2>/dev/null';
    const child = rosSpawn(cmd);
    const flush = () => { pending = false; if (alive) setLines(bufRef.current.slice(-800)); };
    if (child.stdout) child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n---\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 5);
        const lvl = /(?:^|\n)\s*level:\s*(\d+)/.exec(block);
        const nm = /(?:^|\n)\s*name:\s*["']?([^\n"']+)/.exec(block);
        const ms = /(?:^|\n)\s*msg:\s*["']?(.*)/.exec(block);
        bufRef.current.push({ level: lvl ? +lvl[1] : 0, name: nm ? nm[1].trim() : '?', msg: ms ? ms[1].replace(/["']\s*$/, '').trim() : '' });
        if (bufRef.current.length > 1200) bufRef.current.shift();
      }
      if (!pending) { pending = true; setTimeout(flush, 120); }   // 리렌더 폭주 방지
    });
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', () => {});
    return () => { alive = false; try { child.kill(); } catch { /* */ } };
  }, [active, ver]);
  return lines;
}
