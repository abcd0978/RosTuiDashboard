// 토픽/Hz 스트림 — telemetry(.py) 를 python3 로 실행해 1초마다 JSON 한 줄을 파싱.
import { useState, useEffect } from '../react.js';
import { rosSpawn } from '../../../shared/ros.js';
import { TELEM, TELEM2 } from '../../../shared/paths.js';

export function useTopics(ver, ctrlPath, domain) {
  const [topics, setTopics] = useState(null);
  const [conn, setConn] = useState('starting');
  useEffect(() => {
    if (!ver) return;                          // 버전 감지 전엔 대기
    let child, buf = '', alive = true, timer;
    const env = { RDASH_CTRL: ctrlPath };      // 선택적 Hz 제어 파일 경로
    if (domain != null && domain !== '') env.ROS_DOMAIN_ID = String(domain);   // 도메인 전환(다른 컨테이너)
    const start = () => {
      child = rosSpawn('python3 -', env);
      child.stdin.on('error', () => {});
      if (child.stderr) child.stderr.on('data', () => {});   // stderr 버림(파이프 막힘 방지)
      child.stdin.write(ver === '2' ? TELEM2 : TELEM); child.stdin.end();
      child.stdout.on('data', (d) => {
        buf += d.toString(); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          try { const o = JSON.parse(line); setConn('ok'); setTopics(o.nomaster ? null : (o.items || [])); } catch { /* */ }
        }
      });
      child.on('error', () => setConn('exec-error'));
      child.on('exit', () => { if (alive) { setConn('reconnecting'); timer = setTimeout(start, 2000); } });
    };
    start();
    return () => { alive = false; clearTimeout(timer); if (child) child.kill(); };
  }, [ver, domain]);                           // 도메인 바뀌면 재시작(제어파일은 재시작 불필요)
  return { topics, conn };
}
