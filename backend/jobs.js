// 잡(Jobs) 레지스트리 — 웹에서 띄운 프로세스(북마크·rosbag·액션) 추적. Teleop 지속 퍼블리셔 관리.
import { rosSpawn } from '../shared/ros.js';
import { useRbCmd, rbCmdEnsure } from './telemetry.js';

// 자식 프로세스 출력은 '텍스트 줄'이 아니라 임의의 바이트다. 그대로 담아 두면 렌더러가 깨진다:
//   CR   — 진행바(make, ros2 bag)가 커서를 줄 맨 앞으로 보낸다. TUI 에선 오버레이 테두리를 덮어쓴다.
//   ANSI — roslaunch/ros2 는 색을 칠한다. 폭 계산이 어긋나고, 웹에선 이스케이프가 글자로 보인다.
//   TAB  — 터미널은 8 칸으로 펴는데 폭 계산은 1 칸으로 세서 박스를 넘긴다.
// 여기서 한 번 정규화한다 — TUI·웹 두 렌더러가 같은 log 배열을 쓰므로 고칠 곳은 여기 하나다.
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;                    // CSI 시퀀스
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;              // 남은 제어문자(ESC 단독 포함)
export function splitLog(s) {   // export = test/test_joblog.mjs 가 검증한다
  return String(s).split(/\r\n|[\r\n]/)
    .map((ln) => ln.replace(ANSI_RE, '').replace(/\t/g, '    ').replace(CTRL_RE, ''))
    .filter((ln) => ln !== '');
}

// ── 잡(Jobs) 레지스트리 — 웹에서 띄운 프로세스(북마크·rosbag·액션) 추적 ──
let jobSeq = 0;
export const jobs = new Map();   // id → {id,label,pid,status,log[]}
export function spawnJob(label, cmd) {
  const id = ++jobSeq;
  const child = rosSpawn(cmd, undefined, true);
  const rec = { id, label, pid: child.pid, status: 'run', log: [], child };
  const push = (s) => { for (const ln of splitLog(s)) { rec.log.push(ln); if (rec.log.length > 400) rec.log.shift(); } };
  if (child.stdout) child.stdout.on('data', (d) => push(d.toString()));
  if (child.stderr) child.stderr.on('data', (d) => push(d.toString()));
  child.on('close', (code) => { rec.status = code ? 'error' : 'done'; });
  child.on('error', () => { rec.status = 'error'; });
  jobs.set(id, rec);
  return rec;
}
export function jobView(r) {
  return { id: r.id, label: r.label, pid: r.pid, status: r.status, log: r.log.slice(-30) };
}
// SIGINT 먼저, 그래도 안 죽으면 SIGKILL. 유예는 넉넉해야 한다 —
// roslaunch 는 SIGINT 를 받아야 자기 노드들을 정리하고, 노드는 그래야 ROS 마스터에서 등록을 해제한다.
// 너무 일찍 SIGKILL 하면 노드가 마스터에 "나 빠진다"고 말할 틈이 없어, 죽은 노드의 토픽이 트리에 유령으로
// 계속 남는다(마스터는 그 노드가 살아있다고 믿는다). gazebo/px4 스택은 정리에 몇 초가 걸린다.
const KILL_GRACE_MS = 6000;
export function killJob(id) {
  const r = jobs.get(id);
  if (!r) return null;
  r.status = 'stopping';
  const force = setTimeout(() => { if (jobs.has(id) && r.child.exitCode == null) { try { process.kill(-r.child.pid, 'SIGKILL'); } catch { try { r.child.kill('SIGKILL'); } catch { /* */ } } } }, KILL_GRACE_MS);
  r.child.once('close', () => { clearTimeout(force); r.status = 'killed'; setTimeout(() => jobs.delete(id), 500); });
  try { process.kill(-r.child.pid, 'SIGINT'); } catch { try { r.child.kill('SIGINT'); } catch { /* */ } }
  return r;
}

// ── Teleop — geometry_msgs/Twist 지속 퍼블리셔 하나를 관리(Foxglove Teleop 패널 대응) ──
let teleopId = null, teleopIv = null, teleopTy = 'twist';
function twistMsg(lin, ang, ty) {
  const twist = { linear: { x: lin, y: 0, z: 0 }, angular: { x: 0, y: 0, z: ang } };
  const stamped = /stamped/i.test(ty || '');
  return {
    type: stamped ? 'geometry_msgs/TwistStamped' : 'geometry_msgs/Twist',
    msg: stamped ? { header: { frame_id: '' }, twist } : twist,
  };
}
export function teleopStop(topic) {
  if (teleopIv) { clearInterval(teleopIv); teleopIv = null; }
  if (teleopId && jobs.has(teleopId)) {
    const r = jobs.get(teleopId);
    try { process.kill(-r.child.pid, 'SIGINT'); } catch { try { r.child.kill('SIGINT'); } catch { /* */ } }
  }
  teleopId = null;
  if (topic) {
    if (useRbCmd()) { const { type, msg } = twistMsg(0, 0, teleopTy); rbCmdEnsure().publish(topic, type, msg); }
  }
}
export function teleopSet(topic, lin, ang, ty) {
  teleopStop();
  teleopTy = ty || 'twist';
  const { type, msg } = twistMsg(lin, ang, ty);
  const rbc = rbCmdEnsure();
  rbc.publish(topic, type, msg);
  teleopIv = setInterval(() => rbc.publish(topic, type, msg), 100);
}
