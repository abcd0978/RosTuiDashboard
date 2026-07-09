// ⚙ Jobs 매니저 — RDash 가 띄운 프로세스(북마크·rosbag·플롯) 목록 + 선택 작업 출력.
//   ↑↓ 이동 | k 종료(SIGINT) | K 강제(SIGKILL) | d 제거(종료된 것) | Esc 닫기.
import { h } from '../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../store.js';
import { clamp, pad } from '../lib/util.js';

const badge = (s) => (s === 'run' ? '●run' : s === 'error' ? '×err' : '○done');

export function Jobs() {
  const d = useDashboard();
  const list = d.jobs;
  const idx = clamp(d.jobsOpen.idx, 0, Math.max(0, list.length - 1));
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setJobsOpen(null);
    else if (key.downArrow || ch === 'j') d.setJobsOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, list.length - 1) }));
    else if (key.upArrow) d.setJobsOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, list.length - 1) }));
    else if (!list.length) return;
    else if (ch === 'k') d.killJob(list[idx].id, 'SIGINT');
    else if (ch === 'K') d.killJob(list[idx].id, 'SIGKILL');
    else if (ch === 'd' && list[idx].status !== 'run') d.removeJob(list[idx].id);
  }, { isActive: !!process.stdin.isTTY });

  const sel = list[idx];
  const tail = (sel ? (d.jobLogsRef.current.get(sel.id) || []) : []).slice(-6);
  const w = Math.max(30, (d.cols || 100) - 4);
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'blue', paddingX: 1, width: w + 2 },
    h(Text, { color: 'blue', bold: true }, ` ⚙ Jobs (${list.length}) — k 종료 · K 강제 · d 제거 · Esc 닫기 `),
    ...(list.length
      ? list.slice(0, 8).map((jb, i) => {
          const on = i === idx;
          const col = jb.status === 'run' ? 'green' : jb.status === 'error' ? 'red' : 'gray';
          return h(Text, { key: i, backgroundColor: on ? 'blue' : undefined, color: on ? 'black' : col },
            ` ${on ? '▶' : ' '} ${pad(badge(jb.status), 5)} [${jb.pid || '?'}] ${jb.label} `);
        })
      : [h(Text, { key: 'e', dimColor: true }, ' (실행한 작업 없음 — b 북마크나 R 녹화로 생성) ')]),
    sel ? h(Text, { dimColor: true }, ' ── output ──────────') : null,
    ...tail.map((l, i) => h(Text, { key: 'o' + i, dimColor: true }, pad(' ' + l, w))));
}
