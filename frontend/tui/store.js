// 대시보드 중앙 상태 store — 모든 공유 state·파생값·액션·스트림/마우스 효과를 한 곳에 모아
// Context 로 제공한다. 각 컴포넌트는 useDashboard() 로 필요한 값만 꺼내 쓰고,
// 키보드 입력은 컴포넌트별 useInput(모드 게이팅)으로 자기 책임에서 처리한다.
// ROS 는 이제 백엔드 API 로만 만진다(계약: API.md). 여기서 ROS 프로세스를 spawn 하지 않는다.
// 예외: 세션/북마크/기준선 같은 설정 파일은 백엔드와 같은 호스트에 있으므로 그대로 로컬에서 읽고 쓴다.
// 잡(rosbag·액션·북마크 명령)은 백엔드가 소유한다 — TUI 가 죽어도 살아있고 웹 UI 와 같은 목록을 본다.
import { h, createContext, useContext, useState, useEffect, useRef } from './react.js';
import { useApp } from 'ink';
import { useMouse, useElementPosition } from '@zenobius/ink-mouse';
import { clamp, fuzzy, RATES, LEFT_W } from '../../shared/util.js';
import { buildTree, flattenTree } from './lib/tree.js';
import { numericFields } from '../../shared/ros.js';   // 순수 텍스트 파싱(ROS 안 건드림)
import { flattenSkeleton, buildYaml } from '../../shared/msgform.js';
import { shq } from '../../shared/util.js';
import { api, post, outOf, openStream } from './lib/api.js';
import { loadBookmarks, saveBookmarks, activePreset, presetNames, savePreset } from '../../shared/bookmarks.js';
import { loadPreflight } from '../../shared/preflight.js';
import { loadSession, saveSession, loadHistory, pushHistory } from './lib/session.js';
import { loadBaseline, saveBaseline, snapshot as snapProfile } from '../../shared/baseline.js';
import { diagnose } from './lib/doctor.js';
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
  const sessRef = useRef(loadSession());                // 이전 세션(펼침/워치/모드/마지막 선택)
  const sess = sessRef.current;
  // ROS 환경은 백엔드 것을 받아온다 — 우리 process.env 는 ROS 와 무관하다(우리 셸이지 로봇이 아니다).
  const [env, setEnv] = useState({ host: '?', domain: '?', rmw: '?', master: '', ver: null, backend: '?', url: '' });
  const [domainEdit, setDomainEdit] = useState(null);   // ROS 환경 뷰(읽기 전용) 열림 여부
  const [hzMode, setHzMode] = useState(sess.hzMode || 'all');          // Hz 측정 정책 all|selected|off
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks());   // 명령 북마크 리스트
  const [preset, setPreset] = useState(() => activePreset());   // 활성 북마크 프리셋(px4/turtlesim…) 또는 null
  const [bmOpen, setBmOpen] = useState(null);           // 북마크 오버레이 {idx} 또는 null
  const [bmAdd, setBmAdd] = useState(null);             // 북마크 추가 입력 {step,name,cmd} 또는 null
  const [infoView, setInfoView] = useState(null);       // 정보 오버레이 {title,lines,top} (연결/리소스/TF)
  const [rec, setRec] = useState(null);                 // rosbag 녹화 {id,out,started,n} 또는 null
  const [bagPlay, setBagPlay] = useState(null);         // rosbag 재생 경로 입력 {value} 또는 null
  const [tfEcho, setTfEcho] = useState(null);           // tf echo 프레임 입력 {step,src,tgt} 또는 null
  const [bagCmp, setBagCmp] = useState(null);           // A/B bag 비교 경로 입력 {step,a,b} 또는 null
  const [pubForm, setPubForm] = useState(null);         // 토픽 발행 폼 {name,type,fields,idx} 또는 null
  const [graphOpen, setGraphOpen] = useState(null);     // 노드 그래프 오버레이 {focus,top} 또는 null
  const [qosOpen, setQosOpen] = useState(null);         // QoS 오버레이 {name} 또는 null
  const [logOpen, setLogOpen] = useState(null);         // 로그 뷰어 {min,top,text,typing} 또는 null
  const [paramPanel, setParamPanel] = useState(null);   // 파라미터 튜닝 {node,rows,idx,edit} 또는 null
  const [overviewOpen, setOverviewOpen] = useState(null);   // 시스템 개요 오버레이 또는 null
  const [diagOpen, setDiagOpen] = useState(null);       // 진단 뷰어 또는 null
  const [lifeOpen, setLifeOpen] = useState(null);       // 라이프사이클 전환 {node,idx} 또는 null
  const [teleopOpen, setTeleopOpen] = useState(null);   // Teleop 오버레이 {topic,lin,ang,dir} 또는 null
  const [doctorOpen, setDoctorOpen] = useState(null);   // 🩺 Doctor(헬스 스캔) 오버레이 {idx} 또는 null
  const [baselineOpen, setBaselineOpen] = useState(null);   // 📌 Baseline/회귀 오버레이 {idx} 또는 null
  const [baseline, setBaseline] = useState(() => loadBaseline());   // 저장된 기준선 프로파일
  const [triggerArmed, setTriggerArmed] = useState(false);   // 🔴 트리거 녹화 무장 여부(그래프 ERROR 시 자동 스냅샷)
  const [marked, setMarked] = useState(() => new Set());   // 표시된 토픽(멀티선택 녹화/스냅샷)
  const [pkgNames, setPkgNames] = useState([]);         // 패키지 이름(자동완성용) — ros2 pkg list / rospack
  const [jobs, setJobs] = useState([]);                 // 실행 중/종료 작업(북마크·rosbag·플롯…)
  const [jobsOpen, setJobsOpen] = useState(null);       // Jobs 오버레이 {idx} 또는 null
  const [treeHidden, setTreeHidden] = useState(!!sess.treeHidden);  // 트리 숨김(값 패널 전체폭) — Tab 토글
  const [help, setHelp] = useState(false);              // 도움말 오버레이(?)
  const [watches, setWatches] = useState(() => (Array.isArray(sess.watches) ? sess.watches : []));  // 워치리스트 [{topic, field}]
  const [watchOpen, setWatchOpen] = useState(false);    // 워치 오버레이
  const [preflight] = useState(() => loadPreflight());  // 프리플라이트 체크 정의
  const [preflightOpen, setPreflightOpen] = useState(false);
  const jobsRef = useRef([]); jobsRef.current = jobs;    // 최신 참조
  const jobLogsRef = useRef(new Map());                 // id → 출력 라인(백엔드가 준 log 를 그대로 담음)
  const hiddenJobsRef = useRef(new Set());             // 목록에서 치운 잡 id — 백엔드엔 끝난 잡을 지우는 API 가 없어 클라이언트에서 숨긴다
  const infoRef = useRef({ alive: false, timer: null });
  // Hz 측정 대상 — null=전체, []=측정 안 함, [..]=그 토픽만. 아래 hzMode 효과가 채운다(옛 RDASH_CTRL 파일 대체).
  const [measureList, setMeasureList] = useState(null);
  const { topics, conn } = useTopics(ver, measureList);
  const { cols, rows } = useTermSize();
  const mouse = useMouse();

  const [sel, setSel] = useState(0);
  const [top, setTop] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(-1);   // 마우스가 얹힌 트리 행(호버 하이라이트). 바뀔 때만 갱신.
  const [expanded, setExpanded] = useState(() => new Set(Array.isArray(sess.expanded) ? sess.expanded : []));
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

  // 백엔드가 붙어 있는 ROS 환경(호스트/도메인/RMW/마스터) — EnvBar 표시용. 1회.
  useEffect(() => {
    let alive = true;
    api('/api/env').then((o) => { if (alive && o) setEnv(o); });
    return () => { alive = false; };
  }, [ver]);

  // 패키지 이름 목록(북마크 자동완성용) — 백엔드 호스트에서 실행. 버전 감지 후 1회.
  useEffect(() => {
    if (!ver) return undefined;
    let alive = true;
    post('/api/run', { cmd: ver === '2' ? 'ros2 pkg list' : 'rospack list-names' })
      .then((o) => { if (!alive) return; const out = outOf(o).trim(); setPkgNames(out ? out.split(/\s+/) : []); });
    return () => { alive = false; };
  }, [ver]);

  // 잡(Jobs)은 백엔드가 소유한다 — TUI 가 죽어도 살아있고 웹과 공유된다. 1초 폴링(스트림 없음).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const o = await api('/api/jobs');
      if (!alive || !o || !Array.isArray(o.jobs)) return;
      const list = o.jobs.filter((j) => !hiddenJobsRef.current.has(j.id));
      for (const j of list) jobLogsRef.current.set(j.id, j.log || []);
      setJobs(list);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 마지막 선택 복원 — 토픽이 처음 도착했을 때 한 번(경로 일치 시).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !topics || !sess.activePath) return;
    const it = topics.find((i) => i.p === sess.activePath);
    if (it) { restoredRef.current = true; setActive(it); }
  }, [topics]);

  const fullList = topics || [];
  // ROS2 액션 파생 — 숨은 /_action/ 토픽·서비스에서 액션 이름/타입 추출(트리에 actions/ 로 노출).
  const actionMap = new Map();
  for (const it of fullList) {
    const m = /^(.*)\/_action\//.exec(it.name);
    if (!m) continue;
    const an = m[1];
    if (!actionMap.has(an)) actionMap.set(an, { p: 'actions' + an, kind: 'action', name: an });
    if (it.kind === 'topic' && it.name.endsWith('/_action/feedback') && it.ty) {
      actionMap.get(an).ty = it.ty.replace(/_FeedbackMessage$/, '').replace('/msg/', '/action/');
    }
  }
  const actionItems = [...actionMap.values()];
  const visibleList = fullList.filter((it) => !it.name.includes('/_action/'));   // 숨은 _action/ 항목은 트리에서 감춤
  const treeItems = actionItems.length ? [...visibleList, ...actionItems] : visibleList;
  const filt = filter.trim().toLowerCase();
  const list = filt ? treeItems.filter((it) => fuzzy(filt, it.name.toLowerCase())) : treeItems;
  const flat = flattenTree(buildTree(list), expanded, 0, [], !!filt);
  const n = flat.length;
  useEffect(() => { setSel(0); setTop(0); }, [filt]);   // 필터 바뀌면 선택 맨 위로

  // 선택적 Hz: all=전체 / off=없음 / selected=화면에 보이는 토픽 + 선택 항목.
  // 목록을 useTopics 에 넘기면 훅이 POST /api/measure 로 백엔드에 알린다(백엔드는 이 집합만 구독해 Hz 를 센다).
  const visTopics = flat.filter((r) => r.node.item && r.node.item.kind === 'topic').map((r) => r.node.item.name);
  if (active && active.kind === 'topic') visTopics.push(active.name);
  const visKey = hzMode === 'selected' ? [...new Set(visTopics)].sort().join(',') : hzMode;
  useEffect(() => {
    if (hzMode === 'off') setMeasureList([]);
    else if (hzMode === 'all') setMeasureList(null);
    else setMeasureList([...new Set(visTopics)]);
  }, [visKey, hzMode]);

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
  const historyRef = useRef(loadHistory());   // 명령 히스토리(북마크 에디터 Ctrl+P/N)

  // 토픽 발행 폼 — 타입에서 필드를 뽑아 값만 채우게 한다(구조를 손으로 안 침).
  const openPublishForm = async () => {
    if (!active || active.kind !== 'topic') { setStatus('토픽을 선택하세요'); return; }
    const nm = active.name;
    setStatus('메시지 필드 조회 중…');
    const o = await api(`/api/proto?name=${encodeURIComponent(nm)}&type=${encodeURIComponent(active.ty || '')}`);
    const skel = o && o.skel;
    if (!skel || typeof skel !== 'object') {
      setEdit({ name: nm, value: (o && o.yaml) || '{}', kind: 'topic' });   // 스켈레톤 실패 → YAML 자유 입력 폴백
      setStatus('타입 필드 조회 실패 — YAML 직접 입력');
      return;
    }
    const fields = flattenSkeleton(skel);
    setPubForm({ name: nm, type: (o.type || active.ty || '?'), fields, idx: 0 });
    setStatus(`▲ publish ${nm} — 필드 ${fields.length}개`);
  };
  const submitPubForm = () => {
    const f = pubForm; if (!f) return;
    const msg = buildYaml(f.fields);
    setPubForm(null);
    submitPublish(f.name, msg);
  };

  // x 키 — 선택 항목별 기본 액션. 노드는 죽이기(즉시), 나머지는 입력창/폼.
  const ACT_LABEL = { topic: '▲ publish', service: 'call service', param: 'set param', action: '🎯 action goal', node: '💀 kill node' };
  const doAction = async () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    const k = active.kind, nm = active.name;
    if (k === 'topic') { openPublishForm(); return; }                                          // 발행은 폼으로
    if (k === 'action') { setEdit({ name: nm, value: '{}', kind: 'action' }); return; }         // 액션 goal 입력
    if (k === 'service') { setEdit({ name: nm, value: '{}', kind: 'service' }); return; }       // 서비스 요청 입력
    if (k === 'param') { setEdit({ name: nm, value: '', kind: 'param' }); return; }             // 파라미터 값 입력
    if (k === 'node') {
      setStatus(`💀 kill ${nm} …`);
      setStatus(`${nm}: ${outOf(await post('/api/killnode', { name: nm })) || '(응답 없음)'}`);
      return;
    }
    setStatus(`(${k}) 액션 없음`);
  };
  const doRestart = async () => {
    if (!active) { setStatus('선택된 항목 없음 (Enter 로 선택)'); return; }
    if (active.kind !== 'node') { setStatus(`(${active.kind}) 재시작 대상 아님 (노드만)`); return; }
    const nm = active.name;
    setStatus(`♻ restart ${nm} …`);
    setStatus(`${nm}: ${outOf(await post('/api/restart', { name: nm })) || '(응답 없음)'}`);
  };
  const submitSet = async (name, value) => {   // ROS1 전역 파라미터(ROS2 는 노드별 → ParamPanel)
    setStatus(`set ${name} …`);
    setStatus(`${name} = ${value}  (${outOf(await post('/api/setparam1', { name, value })) || 'ok'})`);
  };
  const submitServiceCall = async (name, req) => {
    setStatus(`call ${name} …`);
    setStatus(`${name}: ${outOf(await post('/api/service', { name, req })) || '(응답 없음)'}`);
  };
  const submitPublish = async (name, msg) => {
    setStatus(`pub ${name} …`);
    setStatus(`${name}: ${outOf(await post('/api/publish', { name, msg })) || '(응답 없음)'}`);
  };
  // 액션 goal 전송 — 백엔드가 잡으로 실행하고, 피드백/결과는 잡 로그에 쌓인다.
  const submitActionGoal = async (name, goal) => {
    const it = actionItems.find((a) => a.name === name);
    const ty = it && it.ty;
    if (!ty) { setStatus(`${name}: 액션 타입 미상`); return; }
    await post('/api/action', { name, type: ty, goal });
    setStatus(`▶ action goal → ${name} (J 에서 피드백)`);
  };
  const submitEdit = (kind, name, value) => (
    kind === 'service' ? submitServiceCall(name, value)
      : kind === 'topic' ? submitPublish(name, value)
        : kind === 'action' ? submitActionGoal(name, value)
          : submitSet(name, value));
  // 필드 선택 오버레이 — 워치리스트 핀 전용(플롯은 웹 PlotLab 으로 일원화, TUI 에선 제거).
  const openFieldPicker = () => {
    if (!active || active.kind !== 'topic') { setStatus('토픽을 선택하세요'); return; }
    const fields = numericFields(echo);
    if (!fields.length) { setStatus('숫자 필드 없음(메시지 수신 대기 중일 수 있음)'); return; }
    setWatchOpen(false);
    setPlotPick({ fields, idx: 0, target: 'watch' });
  };
  const addWatch = (topic, fields) => {
    setWatches((ws) => {
      const next = [...ws];
      for (const f of fields) if (!next.some((w) => w.topic === topic && w.field === f)) next.push({ topic, field: f });
      return next;
    });
    setStatus(`👁 watch +${fields.length}`);
  };
  const removeWatch = (i) => setWatches((ws) => ws.filter((_, j) => j !== i));
  const actHint = active ? (ACT_LABEL[active.kind] || '') : '';

  const move = (d) => {
    const ns = clamp(dsel + d, 0, Math.max(0, n - 1));
    setSel(ns);
    setTop((t) => { let nt = clamp(t, 0, maxTop); if (ns < nt) nt = ns; else if (ns >= nt + VISIBLE) nt = ns - VISIBLE + 1; return nt; });
  };
  // ── 작업(Jobs) — 이제 백엔드가 소유한다. TUI 가 죽어도 살아있고 웹 UI 와 같은 목록을 본다.
  // 여기선 실행 요청만 하고, 상태/로그는 위의 1초 폴링(/api/jobs)이 채운다.
  const runJob = async (label, cmd) => {
    lastCmdRef.current = cmd;               // 북마크 자동채움용
    historyRef.current = pushHistory(cmd);  // 히스토리 누적
    const j = await post('/api/job', { cmd, label });
    return j && j.id;
  };
  const killJob = (id) => { post(`/api/job/${id}/kill`); };
  // 백엔드엔 "끝난 잡 지우기" API 가 없다 → 목록에서만 숨긴다(폴링이 다시 넣지 않도록 기억).
  const removeJob = (id) => { hiddenJobsRef.current.add(id); jobLogsRef.current.delete(id); setJobs((js) => js.filter((j) => j.id !== id)); };

  const cycleHz = () => setHzMode((m) => HZ_MODES[(HZ_MODES.indexOf(m) + 1) % HZ_MODES.length]);
  // ── 북마크(명령 단축) ──────────────────────────────────────────────────────
  const runBookmark = (bm) => {
    if (!bm || !bm.cmd) return;
    runJob(bm.name || bm.cmd, bm.cmd);                 // 백엔드 잡으로 실행 → J 에서 조회/종료
    setStatus(`▶ ${bm.name} (J 로 확인)`);
  };
  const runBookmarkKey = (ch) => {
    const bm = bookmarks.find((b) => b.key === ch);
    if (bm) runBookmark(bm);
  };
  // 북마크 프리셋 순환(px4 ↔ turtlesim …) — 프리셋이 1개 이하면 아무 것도 안 함
  const cyclePreset = () => {
    const names = presetNames();
    if (names.length < 2) return;
    const p = names[(names.indexOf(preset) + 1) % names.length];
    setPreset(p); setBookmarks(loadBookmarks(p)); savePreset(p);
    setStatus(`프리셋: ${p}`);
  };
  const addBookmark = (name, cmd) => {
    // 비어있는 숫자키(1..9,0)를 재사용해 배정 — 10개까진 즉시 단축키, 그 이상은 키 없이 저장(목록에서 실행).
    const used = new Set(bookmarks.map((b) => b.key));
    const key = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].find((k) => !used.has(k)) || '';
    const next = [...bookmarks, { name: name || cmd, cmd, key }];
    setBookmarks(next); saveBookmarks(next, preset);
    setStatus(`북마크 추가: ${key ? `[${key}] ` : ''}${name || cmd}  (총 ${next.length}개)`);
  };
  const deleteBookmark = (i) => {
    const next = bookmarks.filter((_, j) => j !== i);
    setBookmarks(next); saveBookmarks(next, preset);
  };
  // 수정 — 단축키(key)는 그대로 두고 이름/명령만 갈아끼운다.
  const updateBookmark = (i, name, cmd) => {
    if (!bookmarks[i]) return;
    const next = bookmarks.map((b, j) => (j === i ? { ...b, name: name || cmd, cmd } : b));
    setBookmarks(next); saveBookmarks(next, preset);
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
  // ── 정보 오버레이(연결/리소스/TF) — API 조회 결과를 스크롤 표시, 선택적 주기 갱신 ──
  // fetcher: async () => string. 명령 문자열이 아니라 API 호출 함수를 받는다.
  const openInfo = (title, fetcher, refreshMs) => {
    clearTimeout(infoRef.current.timer);
    infoRef.current.alive = true;
    const run = async () => {
      const out = await fetcher();
      if (!infoRef.current.alive) return;
      setInfoView((v) => v && ({ ...v, lines: (String(out).trim() || '(빈 값)').split('\n') }));
      if (refreshMs && infoRef.current.alive) infoRef.current.timer = setTimeout(run, refreshMs);
    };
    setInfoView({ title, lines: ['(조회 중…)'], top: 0 });
    run();
  };
  const closeInfo = () => { infoRef.current.alive = false; clearTimeout(infoRef.current.timer); setInfoView(null); };
  const openConnections = () => {
    if (!active) { setStatus('선택 항목 없음 (Enter 로 선택)'); return; }
    const { kind, name } = active;
    openInfo(`🔗 ${name} [${kind}]`, async () => outOf(await api(`/api/connections?kind=${kind}&name=${encodeURIComponent(name)}`)));
  };
  const openResource = () => {
    const nodes = fullList.filter((i) => i.kind === 'node').map((i) => i.name);
    if (!nodes.length) { setStatus('노드 없음'); return; }
    openInfo('📊 node resources (CPU%/RSS)', async () => outOf(await post('/api/resource', { nodes })), 2000);   // 2초마다 갱신
  };
  const openTf = () => openInfo('🌳 TF tree (/tf 수집 중, ~3s)', async () => outOf(await api('/api/tftree')));
  // 노드 그래프 — 선택이 노드면 그 노드 중심, 아니면 전체 엣지.
  const graphFocusName = active && active.kind === 'node' ? active.name : null;
  const openGraph = () => setGraphOpen({ focus: graphFocusName, top: 0 });
  // 메시지 정의(타입 구조) — 선택 토픽/서비스의 필드.
  const openMsgDef = () => {
    if (!active || !active.ty) { setStatus('타입 있는 토픽을 선택하세요'); return; }
    const ty = active.ty;
    openInfo(`📄 ${ty}`, async () => outOf(await api(`/api/msgdef?type=${encodeURIComponent(ty)}`)));
  };
  // QoS 뷰 — 선택 토픽만. 엣지(pubs/subs 의 reliability/durability)에서 계산.
  const openLog = () => setLogOpen({ min: 20, top: null, text: '', typing: false });
  const openOverview = () => setOverviewOpen({});
  const openDiag = () => setDiagOpen({});
  // 파라미터 튜닝 패널 — ROS2 노드별. 라이브로 값 조회/설정.
  const openParamPanel = () => {
    if (ver !== '2') { setStatus('파라미터 패널은 ROS2 노드 전용 (ROS1은 트리 params/ 에서 x)'); return; }
    if (!active || active.kind !== 'node') { setStatus('노드를 선택하세요'); return; }
    const node = active.name;
    setParamPanel({ node, rows: null, idx: 0, edit: null });
    setStatus(`⚙ ${node} 파라미터 조회 중…`);
    api(`/api/param/list?node=${encodeURIComponent(node)}`).then((o) => {
      const rows = (o && o.rows) || [];
      setParamPanel((p) => (p && p.node === node ? { ...p, rows } : p));
    });
  };
  // /api/param/set 이 설정 후 읽어온 값을 그대로 돌려주므로 따로 재조회하지 않는다.
  const setParam = async (node, name, val) => {
    setStatus(`set ${name} = ${val} …`);
    const o = await post('/api/param/set', { node, name, value: val });
    const nv = (o && typeof o.value === 'string') ? o.value.trim() : String(val);
    setStatus(`${name} = ${nv}`);
    setParamPanel((p) => (p && p.node === node ? { ...p, rows: (p.rows || []).map((r) => (r.name === name ? { ...r, value: nv } : r)) } : p));
  };
  const openQos = () => {
    if (!active || active.kind !== 'topic') { setStatus('토픽을 선택하세요'); return; }
    setQosOpen({ name: active.name });
  };
  // 현재 선택 항목 이름을 터미널 클립보드로(OSC52 — SSH 로도 동작).
  const copySelection = () => {
    const r = R.current.flat[dsel];
    const name = r && (r.node.item ? r.node.item.name : r.node.name);
    if (!name) { setStatus('복사할 항목 없음'); return; }
    try { process.stdout.write(`\x1b]52;c;${Buffer.from(name).toString('base64')}\x07`); setStatus(`📋 복사: ${name}`); }
    catch { setStatus('클립보드 복사 실패'); }
  };
  const submitTfEcho = (src, tgt) => {
    if (!src.trim() || !tgt.trim()) { setStatus('두 프레임 필요'); return; }
    const s = src.trim(), t = tgt.trim();
    openInfo(`🧭 tf ${s} → ${t}`, async () => outOf(await api(`/api/tfecho?src=${encodeURIComponent(s)}&tgt=${encodeURIComponent(t)}`)), 1500);   // 1.5s 주기 갱신
  };
  const submitBagCompare = (a, b) => {
    if (!a.trim() || !b.trim()) { setStatus('두 bag 경로 필요'); return; }
    const x = a.trim(), y = b.trim();
    openInfo(`🔀 bag A/B  ${x} ↔ ${y}`, async () => outOf(await api(`/api/bagcompare?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`)));
  };
  // ── rosbag 녹화/재생 — 백엔드 잡으로. 파일도 백엔드 호스트에 떨어진다. ────────────
  const toggleRec = async () => {
    if (rec) { killJob(rec.id); setRec(null); setStatus('■ 녹화 정지'); return; }
    // 우선순위: 표시(marked) 토픽 > 필터 결과 > 전체.
    const recTopics = marked.size ? [...marked] : (filt ? list.filter((i) => i.kind === 'topic').map((i) => i.name) : []);
    const j = await post('/api/record', { topics: recTopics });
    if (!j || !j.id) { setStatus('녹화 시작 실패'); return; }
    setRec({ id: j.id, out: j.label, started: Date.now(), n: recTopics.length });
    setStatus(`● 녹화: ${recTopics.length ? recTopics.length + ' 토픽' + (marked.size ? '(표시)' : '(필터)') : '전체'} → ${j.label}`);
  };
  // 토픽 표시 토글(멀티선택) — 선택 행이 토픽일 때.
  const toggleMark = () => {
    const r = R.current.flat[dsel]; const it = r && r.node.item;
    if (!it || it.kind !== 'topic') { setStatus('토픽 행에서 . 로 표시(녹화/스냅샷 대상)'); return; }
    setMarked((s) => { const nn = new Set(s); nn.has(it.name) ? nn.delete(it.name) : nn.add(it.name); return nn; });
  };
  const clearMarks = () => setMarked(new Set());
  // 스냅샷 — 표시(또는 선택) 토픽의 현재 값 1개씩을 파일로 덤프(버그리포트용).
  // 스냅샷/트리거는 셸 한 줄이면 되는 일이라 전용 라우트를 만들지 않고 백엔드 잡으로 던진다(/api/job).
  const snapCmd = (sel, out) => {
    const echo1 = (t) => (ver === '2' ? `timeout 2 ros2 topic echo --once ${shq(t)}` : `timeout 2 rostopic echo -n1 ${shq(t)}`);
    return sel.map((t) => `echo '=== ${t} ==='; ${echo1(t)}`).join('; ') + ` > ${shq(out)} 2>&1`;
  };
  const snapshot = () => {
    const sel = marked.size ? [...marked] : (active && active.kind === 'topic' ? [active.name] : []);
    if (!sel.length) { setStatus('스냅샷: 토픽을 . 로 표시하거나 선택하세요'); return; }
    const out = `rdash_snapshot_${Date.now()}.txt`;
    runJob(`snapshot → ${out}`, snapCmd(sel, out));
    setStatus(`📸 snapshot: ${sel.length} 토픽 → ${out} (J 에서 확인)`);
  };
  // 라이프사이클(ROS2 managed node) — 전환 선택.
  const openLifecycle = () => {
    if (ver !== '2') { setStatus('라이프사이클은 ROS2 전용'); return; }
    if (!active || active.kind !== 'node') { setStatus('노드를 선택하세요'); return; }
    setLifeOpen({ node: active.name, idx: 0 });
  };
  const runLifecycle = async (node, transition) => {
    setStatus(`lifecycle ${transition}: ${outOf(await post('/api/lifecycle', { node, transition })) || '(응답 없음)'}`);
  };
  // Teleop — 백엔드가 지속 퍼블리셔를 하나 들고 있다(상태 있음). 한 번 POST 하면 계속 발행하므로
  // 타이머로 재전송하지 않는다. 정지는 stop:true 한 번.
  const teleopStop = (topic) => { post('/api/teleop', { topic, stop: true }); };
  const teleopDrive = (topic, lin, ang) => { post('/api/teleop', { topic, lin, ang }); };
  const openTeleop = () => setTeleopOpen({ topic: '/cmd_vel', lin: 0.5, ang: 1.0, dir: 'stop' });
  const openDoctor = () => setDoctorOpen({ idx: 0 });
  const openBaseline = () => setBaselineOpen({ idx: 0 });
  const saveBaselineNow = () => { const prof = snapProfile(fullList, Date.now()); const ok = saveBaseline(prof); if (ok) setBaseline(prof); setStatus(ok ? `📌 기준선 저장 — 노드 ${prof.nodes.length}·토픽 ${Object.keys(prof.topics).length}` : '기준선 저장 실패'); };
  // 🔴 트리거 녹화 — 무장하면 그래프에 ERROR(예: QoS 불일치)가 뜰 때 자동으로 스냅샷을 남긴다(쿨다운 30s).
  const trigRef = useRef({ last: 0 });
  const toggleTrigger = () => setTriggerArmed((a) => { const na = !a; if (na) trigRef.current.last = 0; setStatus(na ? '🔴 트리거 무장 — 그래프 ERROR 발생 시 자동 스냅샷(쿨다운 30s)' : '트리거 해제'); return na; });
  const closeTeleop = () => { setTeleopOpen((p) => { teleopStop(p ? p.topic : '/cmd_vel'); return null; }); };
  const submitBagPlay = (path) => {
    const s = String(path).trim();
    if (!s) return;
    post('/api/play', { path: s });
    setStatus(`▶ play: ${s}`);
  };
  const quit = () => {
    try { saveSession({ expanded: [...expanded], watches, hzMode, treeHidden, activePath: active && active.p }); } catch { /* */ }
    try { mouse.disable(); } catch { /* */ }
    // 잡은 백엔드 것이라 죽이지 않는다(웹에서 계속 보고, TUI 를 다시 켜면 그대로 보인다).
    // 다만 teleop 지속 퍼블리셔와 로컬 플롯 창은 우리가 켠 것이니 정리한다.
    if (teleopOpen) teleopStop(teleopOpen.topic);

    exit();
  };

  // 종료(언마운트) 시 로컬 자원만 정리 — 백엔드 잡은 그대로 살려둔다.
  

  // 🔴 트리거 감시 — 무장 상태에서 그래프 ERROR 감지 시 자동 스냅샷(쿨다운). fullList 갱신마다 폴링.
  useEffect(() => {
    if (!triggerArmed) return;
    const errs = diagnose(fullList).issues.filter((i) => i.sev === 0);
    const now = Date.now();
    if (errs.length && now - trigRef.current.last > 30000) {
      trigRef.current.last = now;
      const sel = marked.size ? [...marked] : fullList.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')).slice(0, 8).map((i) => i.name);
      const out = `rdash_trig_${now}.txt`;
      runJob(`🔴 trigger(${errs[0].target}) → ${out}`, snapCmd(sel, out));
      setStatus(`🔴 트리거 발동: ${errs[0].target} — 스냅샷 ${sel.length}토픽 → ${out} (J 확인)`);
    }
  }, [fullList, triggerArmed]);

  // 마우스: 스크롤(트리/값) + 클릭(트리 행 선택/펼침) + 호버(트리 행 하이라이트). RDASH_MOUSE=0 이면 비활성.
  // 깜빡임은 라인 diff 출력기가 "바뀐 줄만" 다시 그려 해결 → 호버는 상태가 바뀔 때만 리렌더(모션마다 X).
  // 오버레이/입력창이 열려 있으면 트리는 가려져 있으므로 트리용 마우스(스크롤/호버/클릭)를 무시한다.
  const busyRef = useRef(false);
  busyRef.current = !!(edit || plotPick || searching || domainEdit || bmOpen || bmAdd || infoView
    || bagPlay || jobsOpen || help || watchOpen || tfEcho || preflightOpen || bagCmp || pubForm || graphOpen || qosOpen || logOpen || paramPanel || overviewOpen || diagOpen || lifeOpen || teleopOpen || doctorOpen || baselineOpen);

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
    hzMode, domainEdit, env,   // env = 백엔드가 붙어 있는 ROS 환경(GET /api/env). 우리 process.env 가 아니다.
    bookmarks, preset, bmOpen, bmAdd, infoView, rec, bagPlay, tfEcho, bagCmp, jobs, jobsOpen, jobLogsRef,
    treeHidden, help, watches, watchOpen, preflight, preflightOpen, pubForm, pkgNames, graphOpen, graphFocusName, qosOpen, logOpen, paramPanel, overviewOpen, diagOpen, lifeOpen, teleopOpen, doctorOpen, baselineOpen, baseline, triggerArmed, allItems: fullList, marked,
    setSel, setTop, setValTop, setExpanded, setActive, setEdit, setSearching, setPubForm, submitPubForm,
    setGraphOpen, openGraph, setQosOpen, openQos, setLogOpen, openLog, openMsgDef, copySelection,
    setParamPanel, openParamPanel, setParam, setOverviewOpen, openOverview, setDiagOpen, openDiag,
    setLifeOpen, openLifecycle, runLifecycle, setTeleopOpen, openTeleop, closeTeleop, teleopDrive, teleopStop, setDoctorOpen, openDoctor, setBaselineOpen, openBaseline, saveBaselineNow, toggleTrigger, toggleMark, clearMarks, snapshot,
    setFilter, setFrozen, setPlotPick, setRateIdx, setStatus, setDomainEdit,
    setBmOpen, setBmAdd, setInfoView, setBagPlay, setJobsOpen, setHelp, setWatchOpen, setTfEcho, setPreflightOpen, setBagCmp,
    openFieldPicker, addWatch, removeWatch, submitTfEcho, submitBagCompare,
    toggleTree: () => setTreeHidden((v) => !v),
    activate, move, doAction, doRestart, submitSet, submitEdit, quit,
    cycleHz, runBookmark, runBookmarkKey, cyclePreset, addBookmark, deleteBookmark, updateBookmark, bmSeedCmd,
    history: historyRef.current,
    openConnections, openResource, openTf, closeInfo, toggleRec, submitBagPlay,
    killJob, removeJob,
  };
  return h(DashboardContext.Provider, { value: ctx }, children);
}
