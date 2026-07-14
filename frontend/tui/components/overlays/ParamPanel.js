// ⚙ 파라미터 튜닝 (ROS2 노드) — 노드 파라미터 목록 + 라이브 값 조회/설정. paramPanel 모드에서만.
//   ↑↓/클릭 이동 | Enter·더블클릭·e 값 편집 | +/- 숫자 미세조정(±10%) | r 새로고침 | Esc 닫기.
import { h } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp, pad, typable } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

export function ParamPanel() {
  const d = useDashboard();
  const pp = d.paramPanel;
  const rows = pp.rows || [];
  const idx = clamp(pp.idx, 0, Math.max(0, rows.length - 1));
  const cur = rows[idx];

  // 편집은 빈 값으로 시작(현재값은 목록에 보임) — 기존값에 이어붙는 문제 방지.
  const startEdit = () => cur && d.setParamPanel((p) => p && ({ ...p, edit: { name: cur.name, value: '', old: cur.value } }));
  const nudge = (dir) => {
    if (!cur) return;
    const num = parseFloat(cur.value);
    if (!Number.isFinite(num)) { d.setStatus('숫자 파라미터만 +/- 조정'); return; }
    const step = num !== 0 ? Math.abs(num) * 0.1 : 0.1;
    const nv = Number((num + dir * step).toPrecision(6));
    d.setParam(pp.node, cur.name, String(nv));
  };

  useInput((ch, key) => {
    if (pp.edit) {
      if (key.escape) d.setParamPanel((p) => p && ({ ...p, edit: null }));
      else if (key.return) { d.setParam(pp.node, pp.edit.name, pp.edit.value.trim()); d.setParamPanel((p) => p && ({ ...p, edit: null })); }
      else if (key.backspace || key.delete) d.setParamPanel((p) => p && ({ ...p, edit: { ...p.edit, value: p.edit.value.slice(0, -1) } }));
      else if (typable(ch, key)) d.setParamPanel((p) => p && ({ ...p, edit: { ...p.edit, value: p.edit.value + ch } }));
      return;
    }
    if (key.escape || ch === 'q') d.setParamPanel(null);
    else if (!rows.length) return;
    else if (key.return || ch === 'e') startEdit();
    else if (ch === '+' || ch === '=') nudge(1);
    else if (ch === '-' || ch === '_') nudge(-1);
    else if (ch === 'r') d.openParamPanel();
    else if (key.downArrow || ch === 'j') d.setParamPanel((p) => p && ({ ...p, idx: clamp(idx + 1, 0, rows.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setParamPanel((p) => p && ({ ...p, idx: clamp(idx - 1, 0, rows.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  const nameW = Math.min(40, rows.reduce((m, r) => Math.max(m, r.name.length), 6) + 1);
  return h(OverlayFrame, { color: 'magenta', title: `⚙ params — ${pp.node}`, hint: 'Enter/더블클릭 편집 · +/- 미세조정 · r 새로고침 · Esc' },
    pp.rows == null
      ? h(Text, { dimColor: true }, ' 조회 중…')
      : h(List, {
          items: rows, idx, visible: Math.max(3, (d.rows || 20) - (pp.edit ? 9 : 8)), accent: 'magenta',
          onSelect: (i) => d.setParamPanel((p) => p && ({ ...p, idx: i })),
          onActivate: startEdit,
          renderRow: (r) => `${pad(r.name, nameW)} = ${r.value}`,
          emptyText: ' (파라미터 없음 — 노드가 파라미터를 선언 안 했거나 이름이 다름) ',
        }),
    pp.edit
      ? h(Text, { color: 'yellow' }, ` set ${pp.edit.name}  (현재 ${pp.edit.old}) = `)
      : null,
    pp.edit
      ? h(Text, { backgroundColor: 'yellow', color: 'black' }, `${pp.edit.value}▏ `)
      : null);
}
