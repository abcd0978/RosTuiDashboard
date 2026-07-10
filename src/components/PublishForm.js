// 토픽 발행 폼 — 메시지 타입에서 뽑은 필드들을 한 줄씩 보여주고 값만 채워 넣게 한다.
//   ↑↓ 필드 이동 · 입력=현재 필드 편집 · Enter=발행(1회) · Esc=취소.
// (구조를 통째로 외워 YAML 을 손으로 치던 방식 대체)
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { typable, clamp, pad } from '../lib/util.js';

export function PublishForm() {
  const d = useDashboard();
  const f = d.pubForm;
  const fields = f.fields;
  const idx = clamp(f.idx, 0, Math.max(0, fields.length - 1));
  useInput((ch, key) => {
    if (key.escape) { d.setPubForm(null); return; }
    if (key.return) { d.submitPubForm(); return; }
    if (key.upArrow) { d.setPubForm((p) => p && ({ ...p, idx: clamp(idx - 1, 0, fields.length - 1) })); return; }
    if (key.downArrow || key.tab) { d.setPubForm((p) => p && ({ ...p, idx: clamp(idx + 1, 0, fields.length - 1) })); return; }
    if (!fields.length) return;
    // 처음 입력하면 기본값(placeholder)을 대체한다 — "0" 에 이어붙어 "01.0" 되는 문제 방지.
    const edit = (fn) => d.setPubForm((p) => {
      if (!p) return p;
      const nf = p.fields.slice();
      const cur = nf[idx]; const base = cur.value === undefined ? '' : cur.value;
      nf[idx] = { ...cur, value: fn(base) };
      return { ...p, fields: nf };
    });
    if (key.backspace || key.delete) edit((v) => v.slice(0, -1));
    else if (typable(ch, key)) edit((v) => v + ch);
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(30, (d.cols || 100) - 4);
  const nameW = Math.min(28, fields.reduce((m, x) => Math.max(m, x.path.length), 4) + 1);
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'yellow', paddingX: 1, width: w + 2 },
    h(Text, { color: 'yellow', bold: true }, ` ▲ publish  ${f.name} `),
    h(Text, { dimColor: true }, ` type: ${f.type}   ↑↓ 필드 · 입력=값 · Enter=발행(1회) · Esc=취소`),
    ...(fields.length
      ? fields.map((x, i) => {
          const on = i === idx;
          const val = x.value ?? x.def;
          return h(Box, { key: i },
            h(Text, { color: on ? 'yellow' : 'gray' }, ` ${on ? '▶' : ' '} ${pad(x.path, nameW)} `),
            h(Text, { backgroundColor: on ? 'yellow' : undefined, color: on ? 'black' : 'white' }, ` ${val}${on ? '▏' : ''} `),
            h(Text, { dimColor: true }, `  ${x.kind}`));
        })
      : [h(Text, { dimColor: true }, ' (필드 없음 — 빈 메시지)')]));
}
