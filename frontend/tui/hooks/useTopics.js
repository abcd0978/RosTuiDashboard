// 토픽/그래프 스냅샷 — python3 스폰 대신 백엔드 events 멀티플렉스 스트림을 구독한다.
// Hz 측정 정책(all/selected/off)은 store 가 이미 토픽 목록으로 풀어서 넘겨준다(measure 인자).
// null = 전체 측정(현재 그래프의 모든 토픽), [] = 측정 안 함, [..] = 그 토픽만.
import { useState, useEffect, useRef } from '../react.js';
import { openStream, post } from '../lib/api.js';

export function useTopics(ver, measure) {
  const [topics, setTopics] = useState(null);
  const [conn, setConn] = useState('starting');
  const topicsRef = useRef(null);
  topicsRef.current = topics;

  useEffect(() => {
    if (!ver) return undefined;                        // 버전 감지 전엔 대기(기존과 동일한 게이트)
    const unsub = openStream('events', {}, (d) => {
      let o; try { o = JSON.parse(d); } catch { return; }
      if (o.nomaster) { setConn('nomaster'); return; }   // 마지막 items 유지, 연결 끊김만 표시
      setConn('ok'); setTopics(o.items || []);
    });
    return unsub;
  }, [ver]);

  // 측정 대상 통보 — 바뀔 때만 POST(백엔드는 이 집합만 구독해 Hz 를 센다).
  // measure=null(전체)은 그래프가 바뀔 때마다 목록이 달라지므로 topics 도 의존성에 넣는다.
  const sentRef = useRef(null);
  useEffect(() => {
    const items = topicsRef.current || [];
    const list = measure === null
      ? items.filter((t) => t.kind === 'topic').map((t) => t.name)
      : measure;
    const key = JSON.stringify([...list].sort());
    if (key === sentRef.current) return;
    sentRef.current = key;
    post('/api/measure', { topics: list });
  }, [measure, topics]);

  return { topics, conn };
}
