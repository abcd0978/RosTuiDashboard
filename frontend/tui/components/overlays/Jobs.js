// ⚙ Jobs 매니저 — RDash 가 띄운 프로세스(북마크·rosbag·플롯) 목록 + 선택 작업 출력.
//   ↑↓/클릭 이동 | k 종료(SIGINT) | K 강제(SIGKILL) | d 제거(종료된 것) | Esc 닫기.
import { h } from '../../react.js';
import { Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { clamp, pad } from '../../../../shared/util.js';
import { OverlayFrame } from '../common/OverlayFrame.js';
import { List } from '../common/List.js';

const badge = (s) => (s === 'run' ? '●run' : s === 'error' ? '×err' : '○done');
const jobColor = (s) => (s === 'run' ? 'green' : s === 'error' ? 'red' : 'gray');

export function Jobs() {
  const d = useDashboard();
  const list = d.jobs;
  const idx = clamp(d.jobsOpen.idx, 0, Math.max(0, list.length - 1));
  useInput((ch, key) => {
    if (key.escape || ch === 'q') d.setJobsOpen(null);
    else if (key.downArrow || ch === 'j') d.setJobsOpen((p) => p && ({ ...p, idx: clamp(idx + 1, 0, list.length - 1) }));
    else if (key.upArrow) d.setJobsOpen((p) => p && ({ ...p, idx: clamp(idx - 1, 0, list.length - 1) }));
    else if (!list.length) return;
    else if (ch === 'k') d.killJob(list[idx].id);
    else if (ch === 'K') d.killJob(list[idx].id);   // 백엔드가 SIGTERM→SIGKILL 유예 처리
    // 실행 중인 작업은 목록에서 지우지 않는다. 지우면 child 핸들을 잃어 노드를 죽일 길이 없어진다.
    else if (ch === 'd') { const jb = list[idx]; if (jb.status === 'run') d.killJob(jb.id); else d.removeJob(jb.id); }
  }, { isActive: !!process.stdin.isTTY });

  const sel = list[idx];
  const tail = (sel ? (d.jobLogsRef.current.get(sel.id) || []) : []).slice(-6);
  return h(OverlayFrame, { color: 'blue', title: `⚙ Jobs (${list.length})`, hint: 'k 종료 · K 강제 · d 제거(종료된 것만) · Esc' },
    h(List, {
      items: list, idx, visible: Math.max(3, (d.rows || 20) - 13), accent: 'blue',
      onSelect: (i) => d.setJobsOpen((p) => p && ({ ...p, idx: i })),
      renderRow: (jb) => ({ text: `${pad(badge(jb.status), 5)} [${jb.pid || '?'}] ${jb.label}`, color: jobColor(jb.status) }),
      emptyText: ' (실행한 작업 없음 — b 북마크나 R 녹화로 생성) ',
    }),
    sel ? h(Text, { dimColor: true }, ' ── output ──────────') : null,
    // wrap='truncate-end' 없이 pad() 로 자르면 안 된다 — pad 는 문자 수로 세는데 한글·이모지는
    // 터미널에서 2 칸이라, 잘라 낸 줄이 박스보다 넓어져 Ink 가 줄바꿈하고 프레임이 통째로 밀려 나간다.
    ...tail.map((l, i) => h(Text, { key: 'o' + i, dimColor: true, wrap: 'truncate-end' }, ' ' + l)));
}
