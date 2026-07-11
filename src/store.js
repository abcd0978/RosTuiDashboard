// 대시보드 중앙 상태 store — 모든 공유 state·파생값·액션·스트림/마우스 효과를 한 곳에 모아
// Context 로 제공한다. 각 컴포넌트는 useDashboard() 로 필요한 값만 꺼내 쓰고,
// 키보드 입력은 컴포넌트별 useInput(모드 게이팅)으로 자기 책임에서 처리한다.
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { h, createContext, useContext, useState, useEffect, useRef } from './react.js';
import { useApp } from 'ink';
import { useMouse, useElementPosition } from '@zenobius/ink-mouse';
import { clamp, fuzzy, RATES, LEFT_W } from './lib/util.js';
import { buildTree, flattenTree } from './lib/tree.js';
import { actionFor, restartFor, runAction, numericFields, rosSpawn, echoFullCmd, killTree, killTreeHard, protoCmd, runText } from './lib/ros.js';
import { flattenSkeleton, buildYaml } from './lib/msgform.js';
import { shq } from './lib/util.js';
import { PLOT_PY } from './lib/paths.js';
import { rosEnv } from './lib/env.js';
import { loadBookmarks, saveBookmarks } from './lib/bookmarks.js';
import { loadPreflight } from './lib/preflight.js';
import { connectionsCmd, resourceCmd, tfTreeCmd, tfEchoCmd, bagRecordCmd, bagPlayCmd, bagCompareCmd } from './lib/commands.js';
import { useRosVersion } from './hooks/useRosVersion.js';
import { useTopics } from './hooks/useTopics.js';
import { useTermSize } from './hooks/useTermSize.js';
import { useValue } from './hooks/useValue.js';
import { useBandwidth } from './hooks/useBandwidth.js';

const HZ_MODES = ['all', 'selected', 'off'];   // Hz 측정 정책 순환

const DashboardContext = createContext(null);
export const useDashboard = () => useContext(DashboardContext);

export function StoreProvider({ children }) {
  const { exit } = useApp();
  const ver = useRosVersion();
  const [domain, setDomain] = useState(process.env.ROS_DOMAIN_ID ?? null);   // 컨테이너/도메인 전환
  const [domainEdit, setDomainEdit] = useState(null);   // 도메인 입력창 {value} 또는 null
  const [hzMode, setHzMode] = useState('all');          // Hz 측정 정책 all|selected|off
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks());   // 명령 북마크 리스트
  const [bmOpen, setBmOpen] = useState(null);           // 북마크 오버레이 {idx} 또는 null
  const [bmAdd, setBmAdd] = useState(null);             // 북마크 추가 입력 {step,name,cmd} 또는 null
  const [infoView, setInfoView] = useState(null);       // 정보 오버레이 {title,lines,top} (연결/리소스/TF)
  const [rec, setRec] = useState(null);                 // rosbag 녹화 {id,out,started,n} 또는 null
  const [bagPlay, setBagPlay] = useState(null);         // rosbag 재생 경로 입력 {value} 또는 null
  const [tfEcho, setTfEcho] = useState(null);           // tf echo 프레임 입력 {step,src,tgt} 또는 null
  const [bagCmp, setBagCmp] = useState(null);           // A/B bag 비교 경로 입력 {step,a,b} 또는 null
  const [pubForm, setPubForm] = useState(null);         // 토픽 발행 폼 {name,type,fields,idx} 또는 null
  const [pkgNames, setPkgNames] = useState([]);         // 패키지 이름(자동완성용) — ros2 pkg list / rospack
  const [jobs, setJobs] = useState([]);                 // 실행 중/종료 작업(북마크·rosbag·플롯…)
  const [jobsOpen, setJobsOpen] = useState(null);       // Jobs 오버레이 {idx} 또는 null
  const [treeHidden, setTreeHidden] = useState(false);  // 트리 숨김(값 패널 전체폭) — Tab 토글
  const [help, setHelp] = useState(false);              // 도움말 오버레이(?)
  const [watches, setWatches] = useState([]);           // 워치리스트 [{topic, field}]
  const [watchOpen, setWatchOpen] = useState(false);    // 워치 오버레이
  const [preflight] = useState(() => loadPreflight());  // 프리플라이트 체크 정의
  const [preflightOpen, setPreflightOpen] = useState(false);
  const jobsRef = useRef([]); jobsRef.current = jobs;    // 종료 시 정리용 최신 참조
  const jobLogsRef = useRef(new Map());                 // id → 출력 라인 링버퍼(리렌더 폭주 방지)
  const jobSeqRef = useRef(0);
  const infoRef = useRef({ alive: false, timer: null });
  const ctrlPathRef = useRef(join(tmpdir(), `rdash-ctrl-${process.pid}.json`));
  const { topics, conn } = useTopics(ver, ctrlPathRef.current, domain);
  const { cols, rows } = useTermSize();
  const mouse = useMouse();

  const [sel, setSel] = useState(0);
  const [top, setTop] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(-1);   // 마우스가 얹힌 트리 행(호버 하이라이트). 바뀔 때만 갱신.
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

  // 패키지 이름 목록(북마크 자동완성용) — 버전 감지 후 1회, 백그라운드로.
  useEffect(() => {
    if (!ver) return undefined;
    const p = rosSpawn(ver === '2' ? 'ros2 pkg list' : 'rospack list-names');
    let out = '';
    if (p.stderr) p.stderr.on('data', () => {});
    p.stdout.on('data', (dd) => { out += dd.toString(); });
    p.on('close', () => setPkgNames(out.trim() ? out.trim().split(/\s+/) : []));
    p.on('error', () => {});
    return () => { try { p.kill(); } catch { /* */ } };
  }, [ver]);

  const fullList = topics || [];
  const filt = filter.trim().toLowerCase();
  const list = filt ? fullList.filter((it) => fuzzy(filt, it.name.toLowerCase())) : fullList;
  const flat = flattenTree(buildTree(list), expanded, 0, [], !!filt);
  const n = flat.length;
  useEffect(() => { setSel(0); setTop(0); }, [filt]);   // 필터 바뀌면 선택 맨 위로

  // 선택적 Hz: 정책을 제어 파일에 기록(telemetry 가 폴링). all=전체 / off=없음 / selected=보이는 토픽+active.
  const visTopics = flat.filter((r) => r.node.item && r.node.item.kind === 'topic').map((r) => r.node.item.name);
  if (active && active.kind === 'topic') visTopics.push(active.name);
  const visKey = hzMode === 'selected' ? [...new Set(visTopics)].sort().join(',') : hzMode;
  useEffect(() => {
    let measure = 'all';
    if (hzMode === 'off') measure = 'none';
    else if (hzMode === 'selected') measure = [...new Set(visTopics)];
    try { writeFileSync(ctrlPathRef.current, JSON.stringify({ measure })); } catch { /* */ }
  }, [visKey]);

  // 전체 높이 = VISIBLE + 8 (패널 헤더/테두리3 + 오버레이1 + EnvBar1 + 테두리 버튼 푸터3).
  // 화면(rows)보다 크면 Ink 가 매 프레임 전체를 다시 그려 깜빡임 → rows-9 로 한 줄 여유.
  const VISIBLE = Math.max(3, rows - 9);
  const rightW = treeHidden ? Math.max(24, cols - 2) : Math.max(24, cols - LEFT_W - 5);   // 트리 숨기면 전체폭
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
  const activeItem = active && active.kind === 'topic' ? (fullList.find((i) => i.p === active.p) || active) : null;
  const activeHz = activeItem ? activeItem.hz : null;
  const activeAge = activeItem ? activeItem.age : null;

  const activate = (idx) => {
    const r = R.current.flat[idx];
    if (!r) return;
    if (r.hasKids) setExpanded((s) => { const nn = new Set(s); nn.has(r.node.path) ? nn.delete(r.node.path) : nn.add(r.node.path); return nn; });
    else if (r.node.item) setActive(r.node.item);
  };
  const activateRef = useRef(activate); activateRef.current = activate;

  // 마지막으로 실행한 셸 명령 기억 → 북마크 추가 시 자동 채움(명령 안 외워도 됨)
  const lastCmdRef = useRef('');
  const run = (cmd, onDone) => { lastCmdRef.current = cmd; runAction(cmd, onDone); };

  // 토픽 발행 폼 — 타입에서 필드를 뽑아 값만 채우게 한다(구조를 손으로 안 침).
  const openPublishForm = () => {
    if (!active || active.kind !== 'topic') { setStatus('토픽을 선택하세요'); return; }
    const nm = active.name, pc = protoCmd(ver, 'topic', nm, active.ty);
    if (!pc) { setStatus('발행 불가'); return; }
    setStatus('메시지 필드 조회 중…');
    runText(pc, (out) => {
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* */ }
      const skel = parsed && parsed.skel;
      if (!skel || typeof skel !== 'object') {
        setEdit({ name: nm, value: '{}', kind: 'topic' });   // 타입 조회 실패 → YAML 자유 입력 폴백
        setStatus('타입 필드 조회 실패 — YAML 직접 입력');
        return;
      }
      const fields = flattenSkeleton(skel);
      setPubForm({ name: nm, type: (parsed.type || active.ty || '?'), fields, idx: 0 });
      setStatus(`▲ publish ${nm} — 필드 ${fields.length}개`);
    });
  };
  const submitPubForm = () => {
    const f = pubForm; if (!f) return;
    const msg = buildYaml(f.fields);
    setPubForm(null);
    submitPublish(f.name, msg);
  };

  const doAction = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    if (active.kind === 'topic') { openPublishForm(); return; }   // 발행은 폼으로
    const act = actionFor(ver, active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 액션 없음`); return; }
    if (act.needsInput) { setEdit({ name: active.name, value: act.defaultVal || '', kind: active.kind }); return; }
    if (!act.cmd) { setStatus(act.label); return; }
    setStatus(`${act.label} …`);
    run(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const doRestart = () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const act = restartFor(active.kind, active.name);
    if (!act) { setStatus(`(${active.kind}) 재시작 대상 아님 (노드만)`); return; }
    setStatus(`${act.label} …`);
    run(act.cmd, (o) => setStatus(`${active.name}: ${o}`));
  };
  const submitSet = (name, value) => {
    const act = actionFor(ver, 'param', name, value);
    if (act && act.cmd) { setStatus(`set ${name} …`); run(act.cmd, (o) => setStatus(`${name} = ${value}  (${o})`)); }
  };
  const submitServiceCall = (name, req) => {
    const act = actionFor(ver, 'service', name, req);
    if (act && act.cmd) { setStatus(`call ${name} …`); run(act.cmd, (o) => setStatus(`${name}: ${o}`)); }
  };
  const submitPublish = (name, msg) => {
    const act = actionFor(ver, 'topic', name, msg);
    if (act && act.cmd) { setStatus(`pub ${name} …`); run(act.cmd, (o) => setStatus(`${name}: ${o}`)); }
  };
  const submitEdit = (kind, name, value) => (
    kind === 'service' ? submitServiceCall(name, value)
      : kind === 'topic' ? submitPublish(name, value)
        : submitSet(name, value));
  // 필드 선택 오버레이 — target 'plot'(matplotlib) 또는 'watch'(워치리스트 핀)
  const openFieldPicker = (target) => {
    if (!active || active.kind !== 'topic') { setStatus('토픽을 선택하세요'); return; }
    if (target === 'plot' && !process.env.DISPLAY && process.platform === 'linux') {
      setStatus('플롯: $DISPLAY 없음 — GUI(matplotlib) 표시 불가'); return;
    }
    const fields = numericFields(echo);
    if (!fields.length) { setStatus('숫자 필드 없음(메시지 수신 대기 중일 수 있음)'); return; }
    setWatchOpen(false);
    setPlotPick({ fields, idx: 0, target });
  };
  const doPlot = () => openFieldPicker('plot');
  const addWatch = (topic, fields) => {
    setWatches((ws) => {
      const next = [...ws];
      for (const f of fields) if (!next.some((w) => w.topic === topic && w.field === f)) next.push({ topic, field: f });
      return next;
    });
    setStatus(`👁 watch +${fields.length}`);
  };
  const removeWatch = (i) => setWatches((ws) => ws.filter((_, j) => j !== i));
  // fields: 문자열 또는 배열. mode: 'time'(원값/미분·적분/FFT, 다중=오버레이) | 'xy'(2필드 산점도+선형회귀)
  const launchPlot = (fields, mode = 'time') => {
    const fl = Array.isArray(fields) ? fields : [fields];
    const title = `${active.name} / ${fl.join(', ')}${mode === 'xy' ? ' (xy)' : ''}`;
    const fieldArgs = fl.map((f) => `--field ${shq(f)}`).join(' ');
    const cmd = `${echoFullCmd(ver, active.name)} | python3 ${shq(PLOT_PY)} ${fieldArgs} --mode ${mode} --title ${shq(title)}`;
    spawnJob(`plot ${mode}: ${fl.join(',')}`, cmd);
    setStatus(`📈 plot ${mode}: ${fl.join(', ')}`);
  };
  const actHint = active ? ((actionFor(ver, active.kind, active.name) || {}).label || '') : '';

  const move = (d) => {
    const ns = clamp(dsel + d, 0, Math.max(0, n - 1));
    setSel(ns);
    setTop((t) => { let nt = clamp(t, 0, maxTop); if (ns < nt) nt = ns; else if (ns >= nt + VISIBLE) nt = ns - VISIBLE + 1; return nt; });
  };
  // ── 작업(Jobs) 레지스트리 — RDash 가 띄운 프로세스를 추적/조회/종료 ──────────────
  const spawnJob = (label, cmd) => {
    lastCmdRef.current = cmd;               // 북마크 자동채움용
    const id = ++jobSeqRef.current;
    const child = rosSpawn(cmd, undefined, true);   // detached=새 그룹 → 파이프라인째 종료 가능
    const lines = []; jobLogsRef.current.set(id, lines);
    const push = (s) => { for (const ln of String(s).split('\n')) { if (ln !== '') { lines.push(ln); if (lines.length > 300) lines.shift(); } } };
    if (child.stdout) child.stdout.on('data', (d) => push(d.toString()));
    if (child.stderr) child.stderr.on('data', (d) => push(d.toString()));
    child.on('close', (code) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: 'done', code } : j))));
    child.on('error', () => { push('(실행 오류)'); setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: 'error' } : j))); });
    setJobs((js) => [...js, { id, label, pid: child.pid, status: 'run', child }]);
    return id;
  };
  // SIGKILL 요청은 곧바로 쏘지 않는다 — roslaunch 가 죽으면 노드들이 고아로 남는다. SIGINT 후 유예.
  const killJob = (id, sig = 'SIGINT') => {
    const j = jobsRef.current.find((x) => x.id === id);
    if (!j) return;
    if (sig === 'SIGKILL') killTreeHard(j.child); else killTree(j.child, sig);
  };
  const removeJob = (id) => { jobLogsRef.current.delete(id); setJobs((js) => js.filter((j) => j.id !== id)); };
  const killAllJobs = () => { for (const j of jobsRef.current) killTree(j.child, 'SIGTERM'); };

  const cycleHz = () => setHzMode((m) => HZ_MODES[(HZ_MODES.indexOf(m) + 1) % HZ_MODES.length]);
  // ── 북마크(명령 단축) ──────────────────────────────────────────────────────
  const runBookmark = (bm) => {
    if (!bm || !bm.cmd) return;
    spawnJob(bm.name || bm.cmd, bm.cmd);               // 작업으로 추적 → J 에서 조회/종료
    setStatus(`▶ ${bm.name} (J 로 확인)`);
  };
  const runBookmarkKey = (ch) => {
    const bm = bookmarks.find((b) => b.key === ch);
    if (bm) runBookmark(bm);
  };
  const addBookmark = (name, cmd) => {
    // 비어있는 숫자키(1..9,0)를 재사용해 배정 — 10개까진 즉시 단축키, 그 이상은 키 없이 저장(목록에서 실행).
    const used = new Set(bookmarks.map((b) => b.key));
    const key = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].find((k) => !used.has(k)) || '';
    const next = [...bookmarks, { name: name || cmd, cmd, key }];
    setBookmarks(next); saveBookmarks(next);
    setStatus(`북마크 추가: ${key ? `[${key}] ` : ''}${name || cmd}  (총 ${next.length}개)`);
  };
  const deleteBookmark = (i) => {
    const next = bookmarks.filter((_, j) => j !== i);
    setBookmarks(next); saveBookmarks(next);
  };
  // 수정 — 단축키(key)는 그대로 두고 이름/명령만 갈아끼운다.
  const updateBookmark = (i, name, cmd) => {
    if (!bookmarks[i]) return;
    const next = bookmarks.map((b, j) => (j === i ? { ...b, name: name || cmd, cmd } : b));
    setBookmarks(next); saveBookmarks(next);
    setStatus(`북마크 수정: ${next[i].key ? `[${next[i].key}] ` : ''}${next[i].name}`);
  };
  // 북마크 cmd 자동채움: 마지막 실행 명령 → 없으면 선택 항목 기준 스캐폴드(명령 안 외워도 됨)
  const scaffoldCmd = () => {
    if (!active) return '';
    const nm = active.name, two = ver === '2';
    if (active.kind === 'service') return two ? `ros2 service call ${shq(nm)} $(ros2 service type ${shq(nm)}) '{}'` : `rosservice call ${shq(nm)}`;
    if (active.kind === 'topic') return two ? `ros2 topic echo ${shq(nm)}` : `rostopic echo ${shq(nm)}`;
    if (active.kind === 'node') return two ? `ros2 node info ${shq(nm)}` : `rosnode info ${shq(nm)}`;
    return '';
  };
  const bmSeedCmd = () => lastCmdRef.current || scaffoldCmd();
  // ── 정보 오버레이(연결/리소스/TF) — 명령 실행 결과를 스크롤 표시, 선택적 주기 갱신 ──
  const openInfo = (title, cmd, refreshMs) => {
    clearTimeout(infoRef.current.timer);
    infoRef.current.alive = true;
    const run = () => {
      const p = rosSpawn(cmd);
      let out = '';
      if (p.stderr) p.stderr.on('data', () => {});
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('close', () => {
        if (!infoRef.current.alive) return;
        setInfoView((v) => v && ({ ...v, lines: (out.trim() || '(빈 값)').split('\n') }));
        if (refreshMs) infoRef.current.timer = setTimeout(run, refreshMs);
      });
      p.on('error', () => setInfoView((v) => v && ({ ...v, lines: ['(오류)'] })));
    };
    setInfoView({ title, lines: ['(조회 중…)'], top: 0 });
    run();
  };
  const closeInfo = () => { infoRef.current.alive = false; clearTimeout(infoRef.current.timer); setInfoView(null); };
  const openConnections = () => {
    if (!active) { setStatus('선택 항목 없음 (Enter 로 선택)'); return; }
    openInfo(`🔗 ${active.name} [${active.kind}]`, connectionsCmd(ver, active.kind, active.name));
  };
  const openResource = () => {
    const nodes = fullList.filter((i) => i.kind === 'node').map((i) => i.name);
    if (!nodes.length) { setStatus('노드 없음'); return; }
    openInfo('📊 node resources (CPU%/RSS)', resourceCmd(nodes), 2000);   // 2초마다 갱신
  };
  const openTf = () => openInfo('🌳 TF tree (/tf 수집 중, ~3s)', tfTreeCmd(ver));
  const submitTfEcho = (src, tgt) => {
    if (!src.trim() || !tgt.trim()) { setStatus('두 프레임 필요'); return; }
    openInfo(`🧭 tf ${src} → ${tgt}`, tfEchoCmd(ver, src.trim(), tgt.trim()), 1500);   // 1.5s 주기 갱신
  };
  const submitBagCompare = (a, b) => {
    if (!a.trim() || !b.trim()) { setStatus('두 bag 경로 필요'); return; }
    openInfo(`🔀 bag A/B  ${a} ↔ ${b}`, bagCompareCmd(ver, a.trim(), b.trim()));
  };
  // ── rosbag 녹화/재생 ───────────────────────────────────────────────────────
  const toggleRec = () => {
    if (rec) { killJob(rec.id, 'SIGINT'); setRec(null); setStatus('■ 녹화 정지'); return; }
    const recTopics = filt ? list.filter((i) => i.kind === 'topic').map((i) => i.name) : null;
    const out = `rdash_rec_${Date.now()}`;
    const id = spawnJob(`rosbag rec → ${out}`, bagRecordCmd(ver, recTopics, out));
    setRec({ id, out, started: Date.now(), n: recTopics ? recTopics.length : 0 });
    setStatus(`● 녹화: ${recTopics ? recTopics.length + ' 토픽(필터)' : '전체 -a'} → ${out}`);
  };
  const submitBagPlay = (path) => {
    const s = String(path).trim();
    if (!s) return;
    spawnJob(`rosbag play ${s}`, bagPlayCmd(ver, s));
    setStatus(`▶ play: ${s}`);
  };
  const submitDomain = (v) => {
    const s = String(v).trim();
    setDomain(s === '' ? null : s);
    setStatus(`ROS_DOMAIN_ID = ${s || '(unset)'} — 재연결`);
  };
  const quit = () => { try { mouse.disable(); } catch { /* */ } killAllJobs(); exit(); };

  // 종료(언마운트) 시 모든 작업 정리
  useEffect(() => () => killAllJobs(), []);

  // 마우스: 스크롤(트리/값) + 클릭(트리 행 선택/펼침) + 호버(트리 행 하이라이트). RDASH_MOUSE=0 이면 비활성.
  // 깜빡임은 라인 diff 출력기가 "바뀐 줄만" 다시 그려 해결 → 호버는 상태가 바뀔 때만 리렌더(모션마다 X).
  // 오버레이/입력창이 열려 있으면 트리는 가려져 있으므로 트리용 마우스(스크롤/호버/클릭)를 무시한다.
  const busyRef = useRef(false);
  busyRef.current = !!(edit || plotPick || searching || domainEdit || bmOpen || bmAdd || infoView
    || bagPlay || jobsOpen || help || watchOpen || tfEcho || preflightOpen || bagCmp || pubForm);

  useEffect(() => {
    if (!process.stdin.isTTY || process.env.RDASH_MOUSE === '0') return;
    mouse.enable();
    const onScroll = (p, dir) => {
      if (busyRef.current) return;
      if (dir !== 'scrolldown' && dir !== 'scrollup') return;
      const d = dir === 'scrolldown' ? 3 : -3;
      if (p && p.x > LEFT_W) setValTop((v) => clamp(v + d, 0, valMaxRef.current));
      else setTop((t) => clamp(t + d, 0, Math.max(0, R.current.n - R.current.VISIBLE)));
    };
    // 트리 행 호버 → hoverIdx (클릭 히트테스트와 같은 좌표 계산). 값이 바뀔 때만 setState.
    const treeRowAt = (p) => {
      if (!p || p.x > LEFT_W + 1) return -1;
      const slot = p.y - (R.current.listPos.top || 0) - 1;
      if (slot < 0 || slot >= R.current.VISIBLE) return -1;
      const idx = R.current.dtop + slot;
      return idx < R.current.n ? idx : -1;
    };
    const onMove = (p) => { const idx = busyRef.current ? -1 : treeRowAt(p); setHoverIdx((cur) => (cur === idx ? cur : idx)); };
    let down = false;   // press→release 한 사이클. 중복 press 무시(열자마자 닫힘 방지)
    const onClick = (pos, action) => {
      if (action === 'release') { down = false; return; }
      if (action !== 'press' || down) return;
      down = true;
      if (busyRef.current) return;
      const idx = treeRowAt(pos);
      if (idx >= 0) { setSel(idx); activateRef.current(idx); }
    };
    mouse.events.on('scroll', onScroll);
    mouse.events.on('position', onMove);
    mouse.events.on('click', onClick);
    return () => {
      mouse.events.off('scroll', onScroll); mouse.events.off('position', onMove); mouse.events.off('click', onClick);
      try { mouse.disable(); } catch { /* */ }
    };
  }, []);

  const ctx = {
    ver, conn, topics, cols, rows,
    sel: dsel, top: dtop, n, maxTop, flat, list, VISIBLE, LW, RW, rightW, hoverIdx,
    expanded, active, echo, bw, activeHz, activeAge, valTop, valMaxRef, frozen, renderHz,
    edit, searching, filter, plotPick, status, actHint, hzHistRef, listRef,
    hzMode, domain, domainEdit, env: rosEnv(ver, domain),
    bookmarks, bmOpen, bmAdd, infoView, rec, bagPlay, tfEcho, bagCmp, jobs, jobsOpen, jobLogsRef,
    treeHidden, help, watches, watchOpen, preflight, preflightOpen, pubForm, pkgNames,
    setSel, setTop, setValTop, setExpanded, setActive, setEdit, setSearching, setPubForm, submitPubForm,
    setFilter, setFrozen, setPlotPick, setRateIdx, setStatus, setDomainEdit,
    setBmOpen, setBmAdd, setInfoView, setBagPlay, setJobsOpen, setHelp, setWatchOpen, setTfEcho, setPreflightOpen, setBagCmp,
    openFieldPicker, addWatch, removeWatch, submitTfEcho, submitBagCompare,
    toggleTree: () => setTreeHidden((v) => !v),
    activate, move, doAction, doRestart, submitSet, submitEdit, doPlot, launchPlot, quit,
    cycleHz, submitDomain, runBookmark, runBookmarkKey, addBookmark, deleteBookmark, updateBookmark, bmSeedCmd,
    openConnections, openResource, openTf, closeInfo, toggleRec, submitBagPlay,
    killJob, removeJob,
  };
  return h(DashboardContext.Provider, { value: ctx }, children);
}
