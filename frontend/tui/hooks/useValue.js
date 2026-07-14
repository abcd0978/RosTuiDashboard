// 선택 항목 값 — kind 별로 다르게.
//   topic  : echo 스트림 구독(화면은 capRef Hz 로 캡)
//   param  : /api/param/get1 주기 폴링 / service·node : /api/connections 주기 폴링(정적)
// frozenRef.current 이 true 면 화면 갱신만 멈춤(구독/폴링 자체는 유지).
import { useState, useEffect } from '../react.js';
import { api, openStream, outOf } from '../lib/api.js';

export function useValue(active, capRef, ver, frozenRef) {
  const [text, setText] = useState('');
  const kind = active && active.kind;
  const name = active && active.name;
  useEffect(() => {
    if (!active) { setText(''); return; }
    let alive = true, timer = null, latest = '(수신 대기…)', last = 0;
    const push = () => { timer = null; last = Date.now(); if (alive && !frozenRef.current) setText(latest); };
    if (kind === 'topic') {
      const throttled = () => {
        const cap = capRef.current, now = Date.now();
        if (now - last >= cap) push();
        else if (!timer) timer = setTimeout(push, cap - (now - last));
      };
      const unsub = openStream('echo', { topic: name }, (d) => {
        try { latest = JSON.parse(d); } catch { return; }
        throttled();
      });
      return () => { alive = false; if (timer) clearTimeout(timer); unsub(); };
    }
    // param / service / node : 주기 폴링(스트리밍 아님)
    const path = kind === 'param'
      ? `/api/param/get1?name=${encodeURIComponent(name)}`
      : `/api/connections?kind=${kind}&name=${encodeURIComponent(name)}`;
    const interval = kind === 'param' ? 1000 : 3000;
    const poll = async () => {
      const o = await api(path);
      if (!alive) return;
      if (o == null) { if (!frozenRef.current) setText('(오류)'); timer = setTimeout(poll, 2000); }
      else { if (!frozenRef.current) setText(outOf(o) || '(빈 값)'); timer = setTimeout(poll, interval); }
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [kind, name, ver]);
  return text;
}