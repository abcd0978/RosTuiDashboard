// 정보 오버레이 — 연결(pub/sub)·노드 리소스·TF 트리 결과를 스크롤 표시. ↑↓ 스크롤, Esc 닫기.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp, pad } from '../../../../shared/util.js';

const H = 14;   // 오버레이에 보이는 최대 줄 수

export function InfoView() {
  const d = useDashboard();
  const { title, lines, top } = d.infoView;
  const maxTop = Math.max(0, lines.length - H);
  const dtop = clamp(top, 0, maxTop);
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.closeInfo();
    else if (key.downArrow || ch === 'j') d.setInfoView((v) => v && ({ ...v, top: clamp(dtop + 1, 0, maxTop) }));
    else if (key.upArrow || ch === 'k') d.setInfoView((v) => v && ({ ...v, top: clamp(dtop - 1, 0, maxTop) }));
    else if (key.pageDown) d.setInfoView((v) => v && ({ ...v, top: clamp(dtop + H, 0, maxTop) }));
    else if (key.pageUp) d.setInfoView((v) => v && ({ ...v, top: clamp(dtop - H, 0, maxTop) }));
  }, { isActive: !!process.stdin.isTTY });

  const w = Math.max(20, (d.cols || 100) - 4);
  const tag = maxTop > 0 ? `${dtop + 1}-${Math.min(lines.length, dtop + H)}/${lines.length} ↕` : '';
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1, width: w + 2 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { color: 'cyan', bold: true }, ` ${title} `),
      h(Text, { dimColor: true }, `${tag}  Esc 닫기 · ↑↓ 스크롤 `)),
    ...Array.from({ length: Math.min(H, lines.length) }, (_, i) => h(Text, { key: i }, pad(lines[dtop + i] ?? '', w))));
}
