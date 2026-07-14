// ♻ 라이프사이클 (ROS2 managed node) — 전환(configure/activate/…) 선택 실행. lifeOpen 모드에서만.
//   ↑↓/클릭 이동 | Enter·더블클릭 실행 | Esc 닫기.  (nav2 등 managed 노드)
import { h } from '../../react.js';
import { useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

const TRANSITIONS = ['configure', 'activate', 'deactivate', 'cleanup', 'shutdown'];

export function LifecycleView() {
  const d = useDashboard();
  const lf = d.lifeOpen;
  const idx = clamp(lf.idx, 0, TRANSITIONS.length - 1);
  const run = (i) => { d.setLifeOpen(null); d.runLifecycle(lf.node, TRANSITIONS[i]); };
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setLifeOpen(null);
    else if (key.return) run(idx);
    else if (key.downArrow || ch === 'j') d.setLifeOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, TRANSITIONS.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setLifeOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, TRANSITIONS.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  return h(OverlayFrame, { color: 'green', title: `♻ lifecycle — ${lf.node}`, hint: 'Enter/더블클릭 실행 · Esc' },
    h(List, {
      items: TRANSITIONS, idx, visible: TRANSITIONS.length, accent: 'green',
      onSelect: (i) => d.setLifeOpen((p) => p && ({ ...p, idx: i })),
      onActivate: run,
      renderRow: (t) => `ros2 lifecycle set → ${t}`,
    }));
}
