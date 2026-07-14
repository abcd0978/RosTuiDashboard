// echo 멀티플렉서 — usesMux 백엔드(RDASH_BACKEND=rcl)에서 토픽별 echo 를 프로세스 1개로 팬아웃(폭증 해결).
import { rosSpawn } from '../shared/ros.js';
import { be } from './ros.js';
import { sse, streamBlocks } from './http.js';

let muxChild = null;
const muxSubs = new Map();   // topic → Set(send)
function muxEnsure() {
  if (muxChild) return muxChild;
  muxChild = rosSpawn(be.echoMux());
  let buf = '';
  muxChild.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const set = muxSubs.get(o.t);
      if (set) for (const send of set) send(JSON.stringify(o.b));
    }
  });
  if (muxChild.stderr) muxChild.stderr.on('data', () => {});
  muxChild.on('close', () => { muxChild = null; });   // 죽으면 다음 요청에 재기동
  return muxChild;
}
export function muxAdd(topic, send) {   // 반환: off() — 구독 해제. SSE/WS 공용.
  muxEnsure();
  if (!muxSubs.has(topic)) {
    muxSubs.set(topic, new Set());
    try { muxChild.stdin.write('+' + topic + '\n'); } catch { /* */ }
  }
  muxSubs.get(topic).add(send);
  return () => {
    const s = muxSubs.get(topic);
    if (s) {
      s.delete(send);
      if (!s.size) {
        muxSubs.delete(topic);
        try { muxChild && muxChild.stdin.write('-' + topic + '\n'); } catch { /* */ }
      }
    }
  };
}
export function muxStream(res, topic) {
  const send = sse(res);
  const off = muxAdd(topic, send);
  res.on('close', off);
}
export const echoStream = (res, topic) => (be.usesMux ? muxStream(res, topic) : streamBlocks(res, be.echo(topic)));
export function muxKill() { try { muxChild && muxChild.kill(); } catch { /* */ } }
