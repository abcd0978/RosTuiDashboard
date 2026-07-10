// ★ 북마크 매니저 — bmOpen 모드에서만 마운트. 저장된 명령을 보고 실행/추가/삭제.
//   ↑↓ 이동 | Enter 실행 | a 추가 | d 삭제 | Esc 닫기.   (숫자 1-9 는 어디서든 즉시 실행)
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { clamp } from '../lib/util.js';

export function Bookmarks() {
  const d = useDashboard();
  const list = d.bookmarks;
  const idx = clamp(d.bmOpen.idx, 0, Math.max(0, list.length - 1));
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setBmOpen(null);
    else if (ch === 'a') { d.setBmOpen(null); d.setBmAdd({ step: 'name', name: '', cmd: d.bmSeedCmd(), ti: -1 }); }
    else if (!list.length) return;
    else if (key.return) { d.setBmOpen(null); d.runBookmark(list[idx]); }
    else if (ch === 'd') d.deleteBookmark(idx);
    else if (key.downArrow || ch === 'j') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, list.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, list.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  // 스크롤 창 — 개수 제한 없이 전부 ↑↓ 로 접근. VIS 는 모달 실제 여유에 맞춤:
  // rows-1(루트) - 4(EnvBar+Footer) - 4(테두리2+헤더1+힌트1) = rows-9. 초과하면 Ink 클리핑으로 줄이 깨진다.
  const VIS = Math.max(3, (d.rows || 20) - 9);
  const top = clamp(idx - VIS + 1 <= 0 ? 0 : idx - VIS + 1, 0, Math.max(0, list.length - VIS));
  const shown = list.slice(top, top + VIS);
  const w = Math.max(30, (d.cols || 100) - 4);   // 폭 고정 + 각 줄 truncate → 긴 명령/한글에도 줄 겹침 방지
  const more = list.length > VIS ? `   ${top > 0 ? '▲' : ''}${top + 1}-${top + shown.length}/${list.length}${top + VIS < list.length ? '▼' : ''}` : '';
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1, width: w + 2 },
    h(Text, { color: 'magenta', bold: true, wrap: 'truncate-end' }, ` ★ 북마크 (${list.length})  ·  Enter 실행 · a 추가 · d 삭제 · Esc 닫기 `),
    ...(list.length
      ? shown.map((b, i) => {
          const gi = top + i;
          const on = gi === idx;
          return h(Text, { key: gi, wrap: 'truncate-end', backgroundColor: on ? 'magenta' : undefined, color: on ? 'black' : undefined },
            ` ${on ? '▶' : ' '} [${b.key || '·'}] ${b.name}  —  ${b.cmd} `);
        })
      : [h(Text, { key: 'e', dimColor: true, wrap: 'truncate-end' }, ' (없음) a 로 추가 — launch·스크립트·자주 쓰는 명령(arm 등). 예: "ros2 launch fast_lio mapping.launch.py" ')]),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, ` 숫자키 1-9,0 = 즉시 실행${more}`));
}
