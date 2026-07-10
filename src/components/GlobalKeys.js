// 전역 키 핸들러(헤드리스) — 오버레이가 없을 때 네비게이션·기능 키를 처리한다.
// 트리를 숨겨도(패널 언마운트) 키가 살아있도록 별도 컴포넌트로 분리, Layout 에 항상 마운트.
import { useDashboard } from '../store.js';
import { useInput } from 'ink';
import { clamp, RATES } from '../lib/util.js';

export function GlobalKeys() {
  const d = useDashboard();
  const active = !!process.stdin.isTTY && !d.edit && !d.plotPick && !d.searching && !d.domainEdit && !d.pubForm
    && !d.bmOpen && !d.bmAdd && !d.infoView && !d.bagPlay && !d.jobsOpen && !d.help && !d.watchOpen && !d.tfEcho && !d.preflightOpen && !d.bagCmp;
  useInput((ch, key) => {
    if (ch === 'q') d.quit();
    else if (ch === '?') d.setHelp(true);                // 도움말
    else if (key.tab) d.toggleTree();                    // 트리 숨김/표시(값 전체폭)
    else if (ch === '/') d.setSearching(true);
    else if (ch === ' ') d.setFrozen((f) => !f);
    else if (ch === 'h') d.cycleHz();
    else if (ch === 'D') d.setDomainEdit({ value: d.domain || '' });
    else if (ch === 'b') d.setBmOpen({ idx: 0 });
    else if (ch === 'J') d.setJobsOpen({ idx: 0 });      // 실행 중 작업(Jobs)
    else if (ch === 'w') d.setWatchOpen(true);           // 워치리스트
    else if (ch === 'F') d.setPreflightOpen(true);       // 프리플라이트 헬스체크
    else if (ch === 'B') d.setBagCmp({ step: 'a', a: '', b: '' });   // A/B bag 비교
    else if (ch === 'c') d.openConnections();
    else if (ch === 't') d.openTf();
    else if (ch === 'T') d.setTfEcho({ step: 'src', src: '', tgt: '' });   // 두 프레임 tf echo
    else if (ch === 'S') d.openResource();
    else if (ch === 'R') d.toggleRec();
    else if (ch === 'P') d.setBagPlay({ value: '' });
    else if (ch >= '1' && ch <= '9') d.runBookmarkKey(ch);
    else if (key.escape && d.filter) d.setFilter('');
    else if (key.downArrow || ch === 'j') d.move(1);
    else if (key.upArrow || ch === 'k') d.move(-1);
    else if (key.pageDown) d.move(d.VISIBLE);
    else if (key.pageUp) d.move(-d.VISIBLE);
    else if (key.return || key.rightArrow || ch === 'l') d.activate(d.sel);
    else if (ch === 'x') d.doAction();
    else if (ch === 'p') d.doPlot();
    else if (ch === 'r') d.doRestart();
    else if (ch === 'g') { d.setSel(0); d.setTop(0); }
    else if (ch === 'G') { d.setSel(Math.max(0, d.n - 1)); d.setTop(d.maxTop); }
    else if (ch === '+' || ch === '=') d.setRateIdx((i) => clamp(i + 1, 0, RATES.length - 1));
    else if (ch === '-' || ch === '_') d.setRateIdx((i) => clamp(i - 1, 0, RATES.length - 1));
    else if (ch === ']') d.setValTop((v) => clamp(v + 3, 0, d.valMaxRef.current));
    else if (ch === '[') d.setValTop((v) => clamp(v - 3, 0, d.valMaxRef.current));
  }, { isActive: active });
  return null;
}
