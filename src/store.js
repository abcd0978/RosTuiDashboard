// 대시보드 중앙 상태 store — 모든 공유 state·파생값·액션·스트림/마우스 효과를 한 곳에 모아
// Context 로 제공한다. 각 컴포넌트는 useDashboard() 로 필요한 값만 꺼내 쓰고,
// 키보드 입력은 컴포넌트별 useInput(모드 게이팅)으로 자기 책임에서 처리한다.
import { h, createContext, useContext, useState, useEffect, useRef } from './react.js';
import { useApp } from 'ink';
import { useMouse, useElementPosition } from '@zenobius/ink-mouse';
import { clamp, fuzzy, RATES, LEFT_W } from './lib/util.js';
import { buildTree, flattenTree } from './lib/tree.js';
import { actionFor, restartFor, runAction, numericFields, rosSpawn, echoFullCmd } from './lib/ros.js';
import { shq } from './lib/util.js';
import { PLOT_PY } from './lib/paths.js';
import { useRosVersion } from './hooks/useRosVersion.js';
import { useTopics } from './hooks/useTopics.js';
import { useTermSize } from './hooks/useTermSize.js';
import { useValue } from './hooks/useValue.js';
import { useBandwidth } from './hooks/useBandwidth.js';

const DashboardContext = createContext(null);
export const useDashboard = () => useContext(DashboardContext);

export function StoreProvider({ children }) {
  const { exit } = useApp();
  const ver = useRosVersion();
  const { topics, conn } = useTopics(ver);
  const { cols, rows } = useTermSize();
  const mouse = useMouse();

  const [sel, setSel] = useState(0);
  const [top, setTop] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const [active, setActive] = useState(null);   // 오른쪽에 볼 항목(item 객체)
  const [valTop, setValTop] = useState(0);       // 값 패널 세로 스크롤 오프셋
  const [edit, setEdit] = useState(null);        // 파라미터 입력창 {name,value} 또는 null
  const [status, setStatus] = useState('');      // 마지막 액션 결과 메시지
  const [filter, setFilter] = useState('');      // 트리 필터('/' 검색)
  const [searching, setSearching] = useState(false);
  const [frozen, setFrozen] = useState(false);   // 값 패널 프리즈(space)
  const [plotPick, setPlotPick] = useState(null);   // 플롯 필드 선택 {fields,idx} 또는 null
  const [rateIdx, setRateIdx] = useState(() => {
    const i = RATES.indexOf(Number(process.env.RENDER_HZ));
    return i >= 0 ? i : 3;                        // 기본 10Hz
  });

  const renderHz = RATES[rateIdx];
  const capRef = useRef(100);
  capRef.current = Math.max(16, Math.round(1000 / renderHz));
  const valMaxRef = useRef(0);                    // 값 스크롤 최대치(ValuePanel 에서 갱신)
  const frozenRef = useRef(false); frozenRef.current = frozen;
  const plotsRef = useRef([]);                    // 스폰한 plot.py 자식들(종료 시 정리)
  useEffect(() => { setValTop(0); setFrozen(false); }, [active && active.p]);   // 항목 바뀌면 맨 위 + 프리즈 해제

  // Hz 히스토리(토픽별) — 스파크라인용
  const hzHistRef = useRef(new Map());
  useEffect(() => {
    if (!topics) return;
    const m = hzHistRef.current;
    for (const it of topics) {
      if (it.kind !== 'topic') continue;
      const a = m.get(it.p) || [];
      a.push(it.hz || 0);
      if (a.length > 8) a.shift();
      m.set(it.p, a);
    }
  }, [topics]);

  const fullList = topics || [];
  const filt = filter.trim().toLowerCase();
  const list = filt ? fullList.filter((it) => fuzzy(filt, it.name.toLowerCase())) : fullList;
  const flat = flattenTree(buildTree(list), expanded, 0, [], !!filt);
  const n = flat.length;
  useEffect(() => { setSel(0); setTop(0); }, [filt]);   // 필터 바뀌면 선택 맨 위로

  const VISIBLE = Math.max(3, rows - 7);          // 세로 여유(풋터 줄바꿈 대비)
  const rightW = Math.max(24, cols - LEFT_W - 5);
  const RW = rightW - 4;                           // 오른쪽 안쪽 폭(테두리2+패딩2)
  const LW = LEFT_W - 6;                           // 왼쪽 안쪽 폭
  const maxTop = Math.max(0, n - VISIBLE);
  const dsel = clamp(sel, 0, Math.max(0, n - 1));
  const dtop = clamp(top, 0, maxTop);

  const listRef = useRef();
  const listPos = useElementPosition(listRef, [topics === null]);
  const R = useRef({}); R.current = { n, dtop, listPos, VISIBLE, flat };

  const echo = useValue(active, capRef, ver, frozenRef);
  const bw = useBandwidth(active, ver);
  const activeHz = active && active.kind === 'topic' ? ((fullList.find((i) => i.p === active.p) || active).hz) : null;

  const activate = (idx) => {
    const r = R.current.flat[idx];
    if (!r) return;
    if (r.hasKids) setExpanded((s) => { const nn = new Set(s); nn.has(r.node.path) ? nn.delete(r.node.path) : nn.add(r.node.path); return nn; });
    else if (r.node.item) setActive(r.node.item);
  };
  const activateRef = useRef(activate); activateRef.current = activate;

  const doAction = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const act = actionFor(ver, active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 액션 없음`); return; }
    if (act.needsInput) { setEdit({ name: active.name, value: '' }); return; }
    if (!act.cmd) { setStatus(act.label); return; }
    setStatus(`${act.label} …`);
    runAction(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const doRestart = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const act = restartFor(active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 재시작 대상 아님 (노드만)`); return; }
    setStatus(`${act.label} …`);
    runAction(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const submitSet = (name, value) => {
    const act = actionFor(ver, 'param', name, value);
    if (act && act.cmd) { setStatus(`set ${name} …`); runAction(act.cmd, (o) => setStatus(`${name} = ${value}  (${o})`)); }
  };
  // p: 선택 토픽의 숫자 필드로 플롯 창(matplotlib) 열기 — 먼저 필드 선택 오버레이
  const doPlot = () => {
    if (!active || active.kind !== 'topic') { setStatus('플롯은 토픽만 (토픽 선택 후 p)'); return; }
    if (!process.env.DISPLAY && process.platform === 'linux') { setStatus('플롯: $DISPLAY 없음 — GUI(matplotlib) 표시 불가'); return; }
    const fields = numericFields(echo);
    if (!fields.length) { setStatus('숫자 필드 없음(메시지 수신 대기 중일 수 있음)'); return; }
    setPlotPick({ fields, idx: 0 });
  };
  // fields: 문자열 또는 배열. mode: 'time'(원값/미분·적분/FFT, 다중=오버레이) | 'xy'(2필드 산점도+선형회귀)
  const launchPlot = (fields, mode = 'time') => {
    const fl = Array.isArray(fields) ? fields : [fields];
    const title = `${active.name} / ${fl.join(', ')}${mode === 'xy' ? ' (xy)' : ''}`;
    const fieldArgs = fl.map((f) => `--field ${shq(f)}`).join(' ');
    const cmd = `${echoFullCmd(ver, active.name)} | python3 ${shq(PLOT_PY)} ${fieldArgs} --mode ${mode} --title ${shq(title)}`;
    const child = rosSpawn(cmd);
    if (child.stderr) child.stderr.on('data', () => {});
    child.on('error', () => setStatus('플롯 실행 오류(python3/matplotlib 확인)'));
    plotsRef.current.push(child);
    setStatus(`📈 plot ${mode}: ${fl.join(', ')}`);
  };
  const actHint = active ? ((actionFor(ver, active.kind, active.name) || {}).label || '') : '';

  const move = (d) => {
    const ns = clamp(dsel + d, 0, Math.max(0, n - 1));
    setSel(ns);
    setTop((t) => { let nt = clamp(t, 0, maxTop); if (ns < nt) nt = ns; else if (ns >= nt + VISIBLE) nt = ns - VISIBLE + 1; return nt; });
  };
  const killPlots = () => { for (const c of plotsRef.current) { try { c.kill(); } catch { /* */ } } };
  const quit = () => { try { mouse.disable(); } catch { /* */ } killPlots(); exit(); };

  // 종료(언마운트) 시 플롯 자식 정리
  useEffect(() => () => killPlots(), []);

  // 마우스: 스크롤(트리/값) + 클릭(트리 행 선택/펼침)
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    mouse.enable();
    const onScroll = (p, dir) => {
      if (dir !== 'scrolldown' && dir !== 'scrollup') return;
      const d = dir === 'scrolldown' ? 3 : -3;
      if (p && p.x > LEFT_W) setValTop((v) => clamp(v + d, 0, valMaxRef.current));
      else setTop((t) => clamp(t + d, 0, Math.max(0, R.current.n - R.current.VISIBLE)));
    };
    let down = false;   // press→release 한 사이클. 중복 press 무시(열자마자 닫힘 방지)
    const onClick = (pos, action) => {
      if (action === 'release') { down = false; return; }
      if (action !== 'press' || down) return;
      down = true;
      if (pos.x > LEFT_W + 1) return;
      const slot = pos.y - (R.current.listPos.top || 0) - 1;
      if (slot >= 0 && slot < R.current.VISIBLE) {
        const idx = R.current.dtop + slot;
        if (idx < R.current.n) { setSel(idx); activateRef.current(idx); }
      }
    };
    mouse.events.on('scroll', onScroll);
    mouse.events.on('click', onClick);
    return () => { mouse.events.off('scroll', onScroll); mouse.events.off('click', onClick); try { mouse.disable(); } catch { /* */ } };
  }, []);

  const ctx = {
    ver, conn, topics, cols, rows,
    sel: dsel, top: dtop, n, maxTop, flat, list, VISIBLE, LW, RW, rightW,
    expanded, active, echo, bw, activeHz, valTop, valMaxRef, frozen, renderHz,
    edit, searching, filter, plotPick, status, actHint, hzHistRef, listRef,
    setSel, setTop, setValTop, setExpanded, setActive, setEdit, setSearching,
    setFilter, setFrozen, setPlotPick, setRateIdx, setStatus,
    activate, move, doAction, doRestart, submitSet, doPlot, launchPlot, quit,
  };
  return h(DashboardContext.Provider, { value: ctx }, children);
}
