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
    else if (ch === 'a') { d.setBmOpen(null); d.setBmAdd({ step: 'name', name: '', cmd: '' }); }
    else if (!list.length) return;
    else if (key.return) { d.setBmOpen(null); d.runBookmark(list[idx]); }
    else if (ch === 'd') d.deleteBookmark(idx);
    else if (key.downArrow || ch === 'j') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, list.length - 1) }));
    else if (key.upArrow || ch === 'k') d.setBmOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, list.length - 1) }));
  }, { isActive: !!process.stdin.isTTY });

  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1 },
    h(Text, { color: 'magenta', bold: true },
      ` ★ 북마크 — Enter 실행 | a 추가 | d 삭제 | Esc 닫기  (숫자키=즉시 실행) `),
    ...(list.length
      ? list.slice(0, 12).map((b, i) => {
          const on = i === idx;
          return h(Text, { key: i, backgroundColor: on ? 'magenta' : undefined, color: on ? 'black' : undefined },
            ` ${on ? '▶' : ' '} [${b.key || '·'}] ${b.name}  —  ${b.cmd} `);
        })
      : [h(Text, { key: 'e', dimColor: true }, ' (없음) a 로 추가 — 예: name "rosbag rec", cmd "rosbag record -a" ')]));
}
