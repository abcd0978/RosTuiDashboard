// /diagnostics(diagnostic_msgs/DiagnosticArray) 스트림 → { name: {level, message} }.
// level: 0=OK 1=WARN 2=ERROR 3=STALE. 진단뷰가 열렸을 때만 구독(active=true).
// 이제 백엔드의 diagnostics 스트림을 구독한다. 페이로드는 JSON 문자열이라 파싱하면 블록 텍스트가 나온다.
import { useState, useEffect, useRef } from '../react.js';
import { openStream } from '../lib/api.js';

export function useDiagnostics(active, ver) {
  const [map, setMap] = useState({});
  const mapRef = useRef({});
  useEffect(() => {
    if (!active) return undefined;
    mapRef.current = {};
    let alive = true, pending = false;
    const flush = () => { pending = false; if (alive) setMap({ ...mapRef.current }); };
    const unsub = openStream('diagnostics', {}, (d) => {
      let block; try { block = JSON.parse(d); } catch { return; }
      const si = block.indexOf('status:');
      const sblock = si >= 0 ? block.slice(si) : block;
      for (const part of sblock.split(/\n\s*- /).slice(1)) {
        const lv = /level:\s*(\d+)/.exec(part);
        const nm = /name:\s*["']?(.*)/.exec(part);
        const ms = /message:\s*["']?(.*)/.exec(part);
        const name = nm ? nm[1].replace(/["']\s*$/, '').trim() : '?';
        mapRef.current[name] = { level: lv ? +lv[1] : 0, message: ms ? ms[1].replace(/["']\s*$/, '').trim() : '' };
      }
      if (!pending) { pending = true; setTimeout(flush, 150); }
    });
    return () => { alive = false; unsub(); };
  }, [active, ver]);
  return map;
}