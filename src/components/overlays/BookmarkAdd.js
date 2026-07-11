// 북마크 추가/수정 — 이름 + 명령(멀티라인) 입력. 목표: 셸에서 치는 것보다 쉽게.
//   · 붙여넣기(여러 글자/여러 줄) 지원
//   · Ctrl+Space = 자동완성 드롭다운(↑↓ 선택 · Enter 넣기 · Esc 닫기) — ROS 서브커맨드·토픽/노드/서비스/패키지
//   · Enter = 명령칸 줄바꿈 / 이름칸 다음 · Ctrl+S = 저장 · Tab/Shift+Tab = 칸 전환 · ←→↑↓ 커서 · Esc = 취소
//   · bmAdd.editIdx 가 있으면 수정 모드: 그 자리를 덮어쓴다(단축키 유지).
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { editable, clamp } from '../../lib/util.js';
import { completions } from '../../lib/complete.js';

// 커서 인덱스 → {row,col}, 그리고 줄 배열.
function rowCol(text, idx) {
  const lines = text.split('\n');
  let r = 0, c = idx;
  for (; r < lines.length; r++) { if (c <= lines[r].length) break; c -= lines[r].length + 1; }
  return { row: Math.min(r, lines.length - 1), col: c, lines };
}
// 세로 이동(↑↓) — 같은 열 유지.
function vmove(text, idx, dir) {
  const { row, col, lines } = rowCol(text, idx);
  const nr = clamp(row + dir, 0, lines.length - 1);
  if (nr === row) return idx;
  let ni = 0;
  for (let i = 0; i < nr; i++) ni += lines[i].length + 1;
  return ni + Math.min(col, lines[nr].length);
}

export function BookmarkAdd() {
  const d = useDashboard();
  const a = d.bmAdd;
  const editing = a.editIdx != null;
  const field = a.field;                 // 'name' | 'cmd'
  const text = a[field];
  const cur = clamp(a.cur ?? text.length, 0, text.length);
  const comp = a.comp;                   // 드롭다운 {start,cands,idx} 또는 null
  const items = d.topics || [];
  const names = {
    topics: items.filter((i) => i.kind === 'topic').map((i) => i.name),
    nodes: items.filter((i) => i.kind === 'node').map((i) => i.name),
    services: items.filter((i) => i.kind === 'service').map((i) => i.name),
    pkgs: d.pkgNames || [],
  };

  // 텍스트 편집 + (드롭다운이 열려있었다면) 후보 재계산해 필터 유지.
  const editReframe = (fn) => d.setBmAdd((e) => {
    if (!e) return e;
    const t = e[e.field];
    const r = fn(t, clamp(e.cur ?? t.length, 0, t.length));
    let nc = null;
    if (e.comp && e.field === 'cmd') {
      const { start, cands } = completions(d.ver, names, r.text, r.cur);
      nc = cands.length ? { start, cands, idx: 0 } : null;
    }
    return { ...e, [e.field]: r.text, cur: r.cur, comp: nc };
  });
  const gotoField = (f) => d.setBmAdd((e) => e && ({ ...e, field: f, cur: (e[f] || '').length, comp: null }));
  const moveCur = (delta) => d.setBmAdd((e) => e && ({ ...e, cur: clamp((e.cur ?? e[e.field].length) + delta, 0, e[e.field].length), comp: null }));
  const openComplete = () => d.setBmAdd((e) => {
    if (!e) return e;
    if (e.field !== 'cmd') return { ...e, field: 'cmd', cur: (e.cmd || '').length };
    const c = clamp(e.cur ?? e.cmd.length, 0, e.cmd.length);
    const { start, cands } = completions(d.ver, names, e.cmd, c);
    return { ...e, comp: cands.length ? { start, cands, idx: 0 } : null };
  });
  const acceptComplete = () => d.setBmAdd((e) => {
    if (!e || !e.comp) return e;
    const c = clamp(e.cur ?? e.cmd.length, 0, e.cmd.length);
    const cand = e.comp.cands[e.comp.idx];
    const cmd = e.cmd.slice(0, e.comp.start) + cand + e.cmd.slice(c);
    return { ...e, cmd, cur: e.comp.start + cand.length, comp: null };
  });
  const save = () => {
    if (editing) d.updateBookmark(a.editIdx, a.name.trim(), a.cmd.trim());
    else d.addBookmark(a.name.trim(), a.cmd.trim());
    d.setBmAdd(null);
  };

  useInput((input, key) => {
    // ── 드롭다운 열림: 방향키=선택, Enter=넣기, Esc=닫기 (나머지는 아래로) ──
    if (comp) {
      if (key.escape) { d.setBmAdd((e) => e && ({ ...e, comp: null })); return; }
      if (key.upArrow || key.downArrow) {
        d.setBmAdd((e) => {
          if (!e || !e.comp) return e;
          const n = e.comp.cands.length;
          return { ...e, comp: { ...e.comp, idx: (e.comp.idx + (key.downArrow ? 1 : -1) + n) % n } };
        });
        return;
      }
      if (key.return || input === '\n') { acceptComplete(); return; }
    }
    if (key.escape) { d.setBmAdd(null); return; }
    if (key.ctrl && input === 's') { save(); return; }                       // 저장(Ctrl+S)
    if (key.ctrl && input === '`') { openComplete(); return; }               // 자동완성(Ctrl+Space)
    if (key.tab) { gotoField(field === 'name' ? 'cmd' : 'name'); return; }   // 칸 전환
    if (key.return || input === '\n') {                                      // 이름칸=다음, 명령칸=줄바꿈
      if (field === 'name') gotoField('cmd');
      else editReframe((t, c) => ({ text: t.slice(0, c) + '\n' + t.slice(c), cur: c + 1 }));
      return;
    }
    if (key.leftArrow) { moveCur(-1); return; }
    if (key.rightArrow) { moveCur(1); return; }
    if ((key.upArrow || key.downArrow) && field === 'cmd') {
      d.setBmAdd((e) => e && ({ ...e, cur: vmove(e.cmd, clamp(e.cur ?? e.cmd.length, 0, e.cmd.length), key.upArrow ? -1 : 1), comp: null })); return;
    }
    if (key.backspace || key.delete) { editReframe((t, c) => (c > 0 ? { text: t.slice(0, c - 1) + t.slice(c), cur: c - 1 } : { text: t, cur: c })); return; }
    const ins = editable(input, key, field === 'cmd');                       // 타이핑/붙여넣기(명령칸은 여러 줄 허용)
    if (ins) editReframe((t, c) => ({ text: t.slice(0, c) + ins + t.slice(c), cur: c + ins.length }));
  }, { isActive: !!process.stdin.isTTY });

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  const w = Math.max(40, (d.cols || 100) - 4);
  // 커서 = 문자열에 캐럿 글리프(▏) 삽입(단일 Text 로 구조 고정 → 재렌더 안정).
  const cell = (line, ci, active) => h(Text, null,
    active ? (line.slice(0, ci) + '▏' + line.slice(ci)) : (line.length ? line : ' '));
  const cmdLines = a.cmd.split('\n');
  const cmdRc = rowCol(a.cmd, field === 'cmd' ? cur : -1);
  // 드롭다운 표시 창(최대 8개, idx 주변)
  let drop = null;
  if (comp) {
    const N = 8;
    const base = comp.cands.length <= N ? 0 : clamp(comp.idx - (N >> 1), 0, comp.cands.length - N);
    drop = { base, items: comp.cands.slice(base, base + N) };
  }
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1, width: w + 2 },
    h(Text, { color: 'magenta', bold: true }, ` ★ 북마크 ${editing ? '수정' : '추가'} `),
    h(Box, null,
      h(Text, { color: field === 'name' ? 'magenta' : 'gray', bold: field === 'name' }, ` ${field === 'name' ? '▶' : ' '} name: `),
      cell(a.name, cur, field === 'name')),
    h(Text, { color: field === 'cmd' ? 'magenta' : 'gray', bold: field === 'cmd' }, ` ${field === 'cmd' ? '▶' : ' '} cmd:`),
    ...cmdLines.map((ln, i) => h(Box, { key: i },
      h(Text, { dimColor: true }, '     '),
      cell(ln, cmdRc.col, field === 'cmd' && i === cmdRc.row))),
    drop
      ? h(Box, { flexDirection: 'column', marginLeft: 3 },
        h(Text, { dimColor: true }, ` 자동완성 (${comp.cands.length}) — ↑↓ 선택 · Enter 넣기 · Esc 닫기`),
        ...drop.items.map((c, i) => {
          const on = drop.base + i === comp.idx;
          return h(Text, { key: i, backgroundColor: on ? 'cyan' : undefined, color: on ? 'black' : 'white' }, ` ${on ? '▶' : ' '} ${c} `);
        }))
      : h(Text, { dimColor: true }, ' Ctrl+Space=자동완성 · Enter=줄바꿈 · Ctrl+S=저장 · Tab=칸 · ←→↑↓ 커서 · 붙여넣기 OK · Esc=취소'));
}
