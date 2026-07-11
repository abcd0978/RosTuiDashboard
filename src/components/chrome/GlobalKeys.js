// 전역 키 핸들러(헤드리스) — 오버레이가 없을 때 네비게이션·기능 키를 처리한다.
// 트리를 숨겨도(패널 언마운트) 키가 살아있도록 별도 컴포넌트로 분리, Layout 에 항상 마운트.
import { useDashboard } from '../../store.js';
import { useInput } from 'ink';
import { clamp, RATES } from '../../lib/util.js';

export function GlobalKeys() {
  const d = useDashboard();
  const active = !!process.stdin.isTTY && !d.edit && !d.plotPick && !d.searching && !d.domainEdit && !d.pubForm
    && !d.bmOpen && !d.bmAdd && !d.infoView && !d.bagPlay && !d.jobsOpen && !d.help && !d.watchOpen && !d.tfEcho && !d.preflightOpen && !d.bagCmp && !d.teleopOpen;
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
    else if (ch === 'n') d.openGraph();                  // 노드 그래프(토폴로지)
    else if (ch === 'm') d.openMsgDef();                 // 메시지 정의(타입 구조)
    else if (ch === 'Q') d.openQos();                    // QoS 검사(발행/구독)
    else if (ch === 'y') d.copySelection();              // 선택 이름 클립보드 복사(OSC52)
    else if (ch === 'L') d.openLog();                    // 로그 뷰어(/rosout)
    else if (ch === 'o') d.openParamPanel();             // 파라미터 튜닝(ROS2 노드)
    else if (ch === 'O') d.openOverview();               // 시스템 개요(ROS htop)
    else if (ch === 'v') d.openDiag();                   // 진단(/diagnostics)
    else if (ch === 'V') d.openLifecycle();              // 라이프사이클(ROS2 managed 노드)
    else if (ch === 'W') d.openTeleop();                 // Teleop(Twist 조종, WASD)
    else if (ch === 'H') d.openDoctor();                 // 🩺 Doctor(헬스 스캔)
    else if (ch === 'K') d.openBaseline();               // 📌 Baseline/회귀(기준선 대비 diff)
    else if (ch === '.') d.toggleMark();                 // 토픽 표시(멀티선택 녹화/스냅샷)
    else if (ch === 'X') d.snapshot();                   // 스냅샷(표시 토픽 값 덤프)
    else if (ch === 't') d.openTf();
    else if (ch === 'T') d.setTfEcho({ step: 'src', src: '', tgt: '' });   // 두 프레임 tf echo
    else if (ch === 'S') d.openResource();
    else if (ch === 'R') d.toggleRec();
    else if (ch === 'P') d.setBagPlay({ value: '' });
    else if ((ch >= '1' && ch <= '9') || ch === '0') d.runBookmarkKey(ch);   // 1-9,0 = 북마크 즉시 실행
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
