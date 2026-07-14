// ★ 북마크 매니저 — bmOpen 모드에서만 마운트. 저장된 명령을 보고 실행/추가/수정/삭제.
//   ↑↓/클릭 이동 | Enter·더블클릭 실행 | a 추가 | e 수정 | d 삭제 | Esc 닫기.  (숫자 1-9,0 은 어디서든 즉시 실행)
import { h } from '../../react.js';
import { Text, useInput } from 'ink';
import { realpathSync } from 'fs';
import { useDashboard } from '../../store.js';
import { RC_PATH } from '../../../../shared/bookmarks.js';
import { clamp } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

// 북마크 파일 경로(심볼릭 링크면 실체까지). 어디를 고쳐야 하는지 헷갈리므로 둘 다 보여준다.
const rcLabel = (() => {
  try { const real = realpathSync(RC_PATH); return real === RC_PATH ? RC_PATH : `${RC_PATH} → ${real}`; }
  catch { return `${RC_PATH} (없음)`; }
})();

export function Bookmarks() {
  const d = useDashboard();
  const list = d.bookmarks;
  const idx = clamp(d.bmOpen.idx, 0, Math.max(0, list.length - 1));
  const run = (i) => { d.setBmOpen(null); d.runBookmark(list[i]); };
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setBmOpen(null);
    else if (ch === 'a') { d.setBmOpen(null); d.setBmAdd({ field: 'name', name: '', cmd: d.bmSeedCmd(), cur: 0, comp: null }); }
    else if (ch === 's') { d.cyclePreset(); d.setBmOpen({ idx: 0 }); }
    else if (!list.length) return;
    else if (key.return) run(idx);
    else if (ch === 'e') { const b = list[idx]; d.setBmOpen(null); d.setBmAdd({ field: 'name', name: b.name || '', cmd: b.cmd || '', cur: 0, comp: null, editIdx: idx }); }
    else if (ch === 'd') d.deleteBookmark(idx);
    else if (key.downArrow || ch === 'j') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, list.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, list.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  const VIS = Math.max(3, (d.rows || 20) - 11);
  return h(OverlayFrame, { color: 'magenta', title: `★ 북마크 ${d.preset ? `[${d.preset}] ` : ''}(${list.length})`, hint: 'Enter·더블클릭 실행 · a 추가 · e 수정 · d 삭제 · Esc' },
    h(List, {
      items: list, idx, visible: VIS, accent: 'magenta',
      onSelect: (i) => d.setBmOpen((p) => p && ({ ...p, idx: i })),
      onActivate: run,
      // 1..9,0 은 즉시 실행 단축키. 그 뒤(11번째~)는 키가 없으므로 목록 순번을 보여준다.
      renderRow: (b, gi) => `[${(b.key || String(gi + 1)).padStart(2)}] ${b.name}  —  ${b.cmd}`,
      emptyText: ' (없음) a 로 추가 — launch·스크립트·자주 쓰는 명령(arm 등). 예: "ros2 launch fast_lio mapping.launch.py" ',
    }),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, ` 숫자키 1-9,0 = 즉시 실행 · 11번째부터는 Enter 로 실행`),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, ` 파일: ${rcLabel} `));
}
