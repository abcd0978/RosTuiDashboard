// 📜 로그 뷰어 (/rosout) — 노드 로그 실시간. logOpen 모드에서만 마운트.
//   ↑↓ 스크롤(맨아래=자동 따라감) | l 최소 레벨 순환(DEBUG→INFO→WARN→ERROR) | / 텍스트 필터 | Esc 닫기.
import { h } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { useRosout } from '../../hooks/useRosout.js';
import { clamp, pad, typable } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

const LEVELS = [10, 20, 30, 40];   // DEBUG, INFO, WARN, ERROR (최소 레벨)
const LNAME = (l) => (l >= 50 ? 'FATAL' : l >= 40 ? 'ERROR' : l >= 30 ? 'WARN' : l >= 20 ? 'INFO' : 'DEBUG');
const LCOL = (l) => (l >= 40 ? 'red' : l >= 30 ? 'yellow' : l >= 20 ? undefined : 'gray');

export function LogViewer() {
  const d = useDashboard();
  const g = d.logOpen;
  const all = useRosout(true, d.ver);
  const flt = (g.text || '').toLowerCase();
  const rows = all.filter((r) => r.level >= g.min && (!flt || (r.name + ' ' + r.msg).toLowerCase().includes(flt)));
  const H = Math.max(4, (d.rows || 20) - 7);
  const maxTop = Math.max(0, rows.length - H);
  const follow = g.top == null;               // top=null → 맨아래 자동 따라감
  const top = follow ? maxTop : clamp(g.top, 0, maxTop);

  useInput((ch, key) => {
    if (key.escape || ch === 'q') { if (g.typing) d.setLogOpen((p) => p && ({ ...p, typing: false })); else d.setLogOpen(null); return; }
    if (g.typing) {
      if (key.return) d.setLogOpen((p) => p && ({ ...p, typing: false }));
      else if (key.backspace || key.delete) d.setLogOpen((p) => p && ({ ...p, text: (p.text || '').slice(0, -1) }));
      else if (typable(ch, key)) d.setLogOpen((p) => p && ({ ...p, text: (p.text || '') + ch }));
      return;
    }
    if (ch === '/') d.setLogOpen((p) => p && ({ ...p, typing: true }));
    else if (ch === 'l') d.setLogOpen((p) => p && ({ ...p, min: LEVELS[(LEVELS.indexOf(p.min) + 1) % LEVELS.length], top: null }));
    else if (key.downArrow || ch === 'j') d.setLogOpen((p) => p && ({ ...p, top: clamp((p.top == null ? maxTop : p.top) + 1, 0, maxTop) }));
    else if (key.upArrow || ch === 'k') d.setLogOpen((p) => p && ({ ...p, top: clamp((p.top == null ? maxTop : p.top) - 1, 0, maxTop) }));
    else if (key.pageDown) d.setLogOpen((p) => p && ({ ...p, top: null }));   // 맨아래로(follow)
    else if (key.pageUp) d.setLogOpen((p) => p && ({ ...p, top: clamp((p.top == null ? maxTop : p.top) - H, 0, maxTop) }));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  const hint = `${g.typing ? `/${g.text || ''}▏` : `≥${LNAME(g.min)}`}  ${follow ? 'TAIL' : `${top + 1}/${rows.length}`} · l 레벨 · / 필터 · Esc`;
  return h(OverlayFrame, { color: 'cyan', title: `📜 로그 /rosout (${rows.length})`, hint },
    ...(rows.length
      ? Array.from({ length: Math.min(H, rows.length) }, (_, i) => {
          const r = rows[top + i]; if (!r) return h(Text, { key: i }, ' ');
          return h(Text, { key: i, color: LCOL(r.level), wrap: 'truncate-end' },
            pad(` ${pad(LNAME(r.level), 5)} ${r.name}: ${r.msg}`, w));
        })
      : [h(Text, { key: 'e', dimColor: true }, ' (로그 없음 — /rosout 수신 대기…) ')]));
}
