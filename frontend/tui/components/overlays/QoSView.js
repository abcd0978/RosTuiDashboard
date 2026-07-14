// 🔌 QoS 뷰 — 선택 토픽의 발행/구독 엔드포인트 QoS(reliability/durability) + 불일치 경고.
// ROS2 "publisher는 있는데 메시지가 안 옴" 의 대표 원인(신뢰성 불일치)을 한눈에.
import { h } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { pad } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

const REL = (r) => (r === 'R' ? 'RELIABLE' : r === 'B' ? 'BEST_EFFORT' : '?');
const DUR = (d) => (d === 'T' ? 'TRANSIENT_LOCAL' : d === 'V' ? 'VOLATILE' : '?');

export function QoSView() {
  const d = useDashboard();
  useInput((ch, key) => { if (key.escape || ch === 'q' || ch === 'Q') d.setQosOpen(null); }, { isActive: !!process.stdin.isTTY });

  const t = (d.topics || []).find((i) => i.kind === 'topic' && i.name === d.qosOpen.name) || { pubs: [], subs: [] };
  const pubs = t.pubs || [], subs = t.subs || [];
  const hasQos = [...pubs, ...subs].some((e) => e[1]);   // ROS1 은 QoS 없음(null)
  // 신뢰성 불일치: RELIABLE 구독자는 BEST_EFFORT 발행자 메시지를 못 받는다.
  const bePubs = pubs.filter((p) => p[1] === 'B').map((p) => p[0]);
  const relSubs = subs.filter((s) => s[1] === 'R').map((s) => s[0]);
  const mismatch = bePubs.length && relSubs.length;

  const w = Math.max(30, (d.cols || 100) - 4);
  const row = (e) => h(Text, { key: e[0] }, pad(`   ${e[0]}`, w - 30) + `${pad(REL(e[1]), 13)} ${DUR(e[2])}`);
  return h(OverlayFrame, { color: mismatch ? 'red' : 'cyan', title: `🔌 QoS — ${d.qosOpen.name}`, hint: 'Esc 닫기' },
    h(Text, { dimColor: true }, ` ${t.ty || ''}`),
    h(Text, { color: 'yellow' }, ` publishers (${pubs.length})`),
    ...(pubs.length ? pubs.map(row) : [h(Text, { key: 'np', dimColor: true }, '   (없음)')]),
    h(Text, { color: 'yellow' }, ` subscribers (${subs.length})`),
    ...(subs.length ? subs.map(row) : [h(Text, { key: 'ns', dimColor: true }, '   (없음)')]),
    !hasQos
      ? h(Text, { dimColor: true }, ' (ROS1: QoS 개념 없음)')
      : mismatch
        ? h(Text, { color: 'red', bold: true }, ` ⚠ reliability 불일치 — RELIABLE 구독자(${relSubs.join(', ')})는 BEST_EFFORT 발행자(${bePubs.join(', ')}) 메시지를 못 받습니다`)
        : h(Text, { color: 'green' }, ' ✓ reliability 호환'));
}
