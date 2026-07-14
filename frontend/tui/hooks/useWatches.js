// 워치리스트 스트림 — 워치된 토픽마다 echo 스트림을 구독한다(멀티플렉스라 소켓 하나에 여러 개).
// 페이로드는 JSON 문자열이므로 파싱해서 기존 필드-추출 헬퍼(fieldValue)에 그대로 넘긴다.
import { useState, useEffect } from '../react.js';
import { openStream } from '../lib/api.js';
import { fieldValue } from '../../../shared/ros.js';

export function useWatches(watches, ver) {
  const [vals, setVals] = useState({});
  const keys = watches.map((w) => `${w.topic}|${w.field}`).join(',');
  useEffect(() => {
    if (!watches.length) { setVals({}); return; }
    const topics = [...new Set(watches.map((w) => w.topic))];
    const latest = {};                       // topic → 최신 echo 텍스트
    const unsubs = topics.map((t) => openStream('echo', { topic: t }, (d) => {
      try { latest[t] = JSON.parse(d); } catch { /* */ }
    }));
    const timer = setInterval(() => {
      const out = {};
      for (const w of watches) {
        out[`${w.topic}|${w.field}`] = latest[w.topic] ? fieldValue(latest[w.topic], w.field) : undefined;
      }
      setVals(out);
    }, 300);
    return () => { clearInterval(timer); for (const u of unsubs) u(); };
  }, [keys, ver]);
  return vals;
}