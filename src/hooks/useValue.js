// 선택 항목 값 — kind 별로 다르게.
//   topic  : rostopic echo 연속 스트리밍(화면은 capRef Hz 로 캡)
//   param  : rosparam get 주기 폴링 / service·node : info 주기 폴링(정적)
// frozenRef.current 이 true 면 화면 갱신만 멈춤(자식 프로세스는 유지).
import { useState, useEffect } from '../react.js';
import { rosSpawn, echoCmd, infoCmd } from '../lib/ros.js';

export function useValue(active, capRef, ver, frozenRef) {
  const [text, setText] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active) { setText(''); return; }
    let alive = true, child, timer = null, buf = '', latest = '(수신 대기…)', last = 0;
    const push = () => { timer = null; last = Date.now(); if (alive && !frozenRef.current) setText(latest); };
    if (kind === 'topic') {
      const throttled = () => {
        const cap = capRef.current, now = Date.now();
        if (now - last >= cap) push();
        else if (!timer) timer = setTimeout(push, cap - (now - last));
      };
      child = rosSpawn(echoCmd(ver, name));
      child.stdout.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n---\n');
        if (parts.length > 1) { const b = parts[parts.length - 2].trimEnd(); if (b) latest = b; buf = parts[parts.length - 1]; }
        throttled();
      });
      child.on('error', () => { if (alive) setText('(echo 오류)'); });
      return () => { alive = false; if (timer) clearTimeout(timer); if (child) child.kill(); };
    }
    // param / service / node : 주기 폴링(스트리밍 아님)
    const cmd = infoCmd(ver, kind, name);
    const interval = kind === 'param' ? 1000 : 3000;
    const poll = () => {
      let out = '';
      child = rosSpawn(cmd);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('close', () => { if (!alive) return; if (!frozenRef.current) setText(out.trimEnd() || '(빈 값)'); timer = setTimeout(poll, interval); });
      child.on('error', () => { if (alive) { setText('(오류)'); timer = setTimeout(poll, 2000); } });
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); if (child) child.kill(); };
  }, [kind, name, ver]);
  return text;
}
