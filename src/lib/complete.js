// ROS 명령 자동완성 엔진 — 북마크 명령 입력창에서 Tab 으로 서브커맨드/토픽·노드·서비스·패키지 이름을 채운다.
// 목적: 셸에서 외워 치는 것보다 쉽게. 엔티티 이름은 대시보드가 이미 들고 있는 목록을 그대로 활용(추가 조회 없음).

const ROS2_SUB = ['topic', 'node', 'service', 'param', 'bag', 'run', 'launch', 'pkg',
  'interface', 'action', 'lifecycle', 'daemon', 'doctor', 'wtf', 'multicast', 'component', 'security'];
const ROS2_VERB = {
  topic: ['echo', 'pub', 'list', 'info', 'hz', 'bw', 'type', 'find', 'delay'],
  node: ['list', 'info'],
  service: ['list', 'call', 'type', 'find', 'echo'],
  param: ['list', 'get', 'set', 'dump', 'load', 'describe'],
  bag: ['record', 'play', 'info', 'reindex', 'convert'],
  pkg: ['list', 'executables', 'prefix', 'xml'],
  interface: ['list', 'show', 'proto', 'package', 'packages'],
  action: ['list', 'info', 'send_goal'],
  lifecycle: ['nodes', 'get', 'set', 'list'],
};
const ROS1_VERB = {
  rostopic: ['echo', 'pub', 'list', 'info', 'hz', 'bw', 'type', 'find'],
  rosnode: ['list', 'info', 'kill', 'ping', 'machine'],
  rosservice: ['list', 'call', 'type', 'find', 'info', 'args'],
  rosparam: ['list', 'get', 'set', 'dump', 'load', 'delete'],
  rosbag: ['record', 'play', 'info', 'filter', 'reindex'],
};
const ROS1_TOOLS = ['rostopic', 'rosnode', 'rosservice', 'rosparam', 'rosbag', 'rosrun', 'roslaunch', 'rossrv', 'rosmsg'];

// 이 자리에서 엔티티 이름(토픽/노드/서비스/패키지) 후보가 필요하면 그 배열을 돌려준다.
function entityCands(ver, toks, names) {
  const [a, b] = toks;
  if (ver === '2') {
    if (a !== 'ros2') return [];
    if (b === 'topic' && ['echo', 'pub', 'info', 'hz', 'bw', 'type', 'find', 'delay'].includes(toks[2])) return names.topics;
    if (b === 'node' && ['info'].includes(toks[2])) return names.nodes;
    if (b === 'service' && ['call', 'type', 'find', 'echo'].includes(toks[2])) return names.services;
    if (b === 'param') return names.nodes;
    if (b === 'bag' && toks[2] === 'record') return names.topics;
    if (b === 'run' || b === 'launch') return names.pkgs;
    return [];
  }
  if (a === 'rostopic' && ['echo', 'pub', 'info', 'hz', 'bw', 'type', 'find'].includes(b)) return names.topics;
  if (a === 'rosnode' && ['info', 'kill', 'ping'].includes(b)) return names.nodes;
  if (a === 'rosservice' && ['call', 'type', 'info', 'args'].includes(b)) return names.services;
  if (a === 'rosparam') return names.nodes;
  if (a === 'rosrun' || a === 'roslaunch') return names.pkgs;
  if (a === 'rosbag' && b === 'record') return names.topics;
  return [];
}

// 완료된 토큰들(toks) 다음에 올 후보 목록.
function candidatesFor(ver, toks, names) {
  if (toks.length === 0) return ver === '2' ? ['ros2'] : ROS1_TOOLS;
  if (ver === '2') {
    if (toks[0] !== 'ros2') return entityCands(ver, toks, names);
    if (toks.length === 1) return ROS2_SUB;
    // 서브에 하위명령 목록이 있으면 그것, 없으면(run/launch 등) 엔티티(패키지 등)로 폴백.
    if (toks.length === 2) return ROS2_VERB[toks[1]] || entityCands(ver, toks, names);
    return entityCands(ver, toks, names);
  }
  if (toks.length === 1) return ROS1_VERB[toks[0]] || entityCands(ver, toks, names);
  return entityCands(ver, toks, names);
}

// cmd 의 cursor 위치에서 현재 토큰과 후보 목록을 계산.
//  names = { topics:[], nodes:[], services:[], pkgs:[] }
export function completions(ver, names, cmd, cursor) {
  const line = cmd.slice(0, cursor).split('\n').pop();           // 현재 줄에서만
  const m = /(\S*)$/.exec(line);
  const token = m[1];
  const start = cursor - token.length;
  const before = line.slice(0, line.length - token.length).trim();
  const toks = before ? before.split(/\s+/) : [];
  let cands = candidatesFor(ver, toks, names) || [];
  const low = token.toLowerCase();
  let hit = cands.filter((c) => c.toLowerCase().startsWith(low));
  // 문맥 후보가 없을 때만: '/' 로 시작하면 토픽/서비스/노드 이름을 폭넓게 제안(폴백).
  if (!hit.length && token.startsWith('/')) {
    const all = [...names.topics, ...names.services, ...names.nodes];
    hit = all.filter((c) => c.includes(token));
  }
  cands = [...new Set(hit)].sort();
  return { token, start, cands: cands.slice(0, 40) };
}
