// 🩺 Doctor — 그래프를 스캔해 QoS 불일치·stale·dead-end 등을 심각도순으로 보여준다. doctorOpen 모드에서만.
//   Foxglove/rviz 엔 없는 자동 진단. ↑↓ 이동 · Enter=해당 토픽으로 점프 · Esc 닫기. 라이브(텔레메트리 갱신마다 재스캔).
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp } from '../../../../shared/util.js';
import { diagnose, SEV } from '../../lib/doctor.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

const COLOR = ['red', 'yellow', 'gray'];   // ERROR · WARN · INFO
const MARK = ['●', '▲', 'ℹ'];

export function DoctorView() {
  const d = useDashboard();
  const { issues, counts, scanned } = diagnose(d.allItems || []);
  const idx = clamp(d.doctorOpen.idx || 0, 0, Math.max(0, issues.length - 1));
  const jump = (i) => {
    const iss = issues[i]; d.setDoctorOpen(null);
    if (!iss) return;
    const it = (d.allItems || []).find((x) => x.name === iss.target);
    if (it) { d.setActive(it); d.setStatus(`🩺 ${iss.target}: ${iss.msg}`); }
  };
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setDoctorOpen(null);
    else if (key.return) jump(idx);
    else if (key.downArrow || ch === 'j') d.setDoctorOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, issues.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setDoctorOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, issues.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const summary = `노드 ${scanned.nodes} · 토픽 ${scanned.topics}  —  ` +
    `${counts.ERROR} ERROR · ${counts.WARN} WARN · ${counts.INFO} INFO`;

  if (!issues.length) {
    return h(OverlayFrame, { color: 'green', title: '🩺 Doctor — 시스템 건강', hint: 'Esc' },
      h(Box, { marginTop: 1 }, h(Text, { color: 'green' }, `✓ 문제 없음 · ${summary}`)));
  }
  return h(OverlayFrame, { color: counts.ERROR ? 'red' : 'yellow', title: '🩺 Doctor — 시스템 건강', hint: 'Enter=점프 · Esc' },
    h(Box, { marginBottom: 1 }, h(Text, { dimColor: true }, summary)),
    h(List, {
      items: issues, idx, visible: Math.min(issues.length, (d.rows || 24) - 8), accent: counts.ERROR ? 'red' : 'yellow',
      onSelect: (i) => d.setDoctorOpen((p) => p && ({ ...p, idx: i })),
      onActivate: jump,
      renderRow: (iss) => ({ text: `${MARK[iss.sev]} ${SEV[iss.sev].padEnd(5)} ${iss.target}  —  ${iss.msg}`, color: COLOR[iss.sev] }),
    }));
}
