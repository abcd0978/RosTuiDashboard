// 🎮 Teleop — geometry_msgs/Twist 를 WASD/화살표로 발행(teleop_twist_keyboard 스타일). teleopOpen 모드에서만.
//   W/S=전·후진, A/D=좌·우회전, Space/x=정지, +/-=속도, Esc=닫기. 방향키를 누르면 -r 10 Hz 로 계속 발행.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { OverlayFrame } from '../common/OverlayFrame.js';

export function TeleopView() {
  const d = useDashboard();
  const t = d.teleopOpen;
  const drive = (dir, lin, ang) => { d.teleopDrive(t.topic, lin, ang); d.setTeleopOpen((p) => p && ({ ...p, dir })); };
  const stop = () => { d.teleopStop(t.topic); d.setTeleopOpen((p) => p && ({ ...p, dir: 'stop' })); };
  useInput((ch, key) => {
    if (key.escape || ch === 'q') { d.closeTeleop(); return; }
    if (ch === 'w' || key.upArrow) drive('전진', t.lin, 0);
    else if (ch === 's' || key.downArrow) drive('후진', -t.lin, 0);
    else if (ch === 'a' || key.leftArrow) drive('좌회전', 0, t.ang);
    else if (ch === 'd' || key.rightArrow) drive('우회전', 0, -t.ang);
    else if (ch === ' ' || ch === 'x') stop();
    else if (ch === '+' || ch === '=') d.setTeleopOpen((p) => p && ({ ...p, lin: +(p.lin + 0.1).toFixed(2), ang: +(p.ang + 0.1).toFixed(2) }));
    else if (ch === '-' || ch === '_') d.setTeleopOpen((p) => p && ({ ...p, lin: Math.max(0, +(p.lin - 0.1).toFixed(2)), ang: Math.max(0, +(p.ang - 0.1).toFixed(2)) }));
  }, { isActive: !!process.stdin.isTTY });

  const cur = t.dir;
  const key = (label, on) => h(Text, { color: on ? 'black' : 'cyan', backgroundColor: on ? 'cyan' : undefined, bold: on }, ` ${label} `);
  const gap = h(Text, null, '   ');
  return h(OverlayFrame, { color: 'cyan', title: `🎮 Teleop — ${t.topic}`, hint: 'W/A/S/D·↑←↓→ 이동 · Space/x 정지 · +/- 속도 · Esc' },
    h(Box, { flexDirection: 'column', alignItems: 'center', marginTop: 1, marginBottom: 1 },
      h(Box, null, gap, key('W', cur === '전진'), gap),
      h(Box, { marginTop: 1 }, key('A', cur === '좌회전'), h(Text, null, ' '), key('■', cur === 'stop'), h(Text, null, ' '), key('D', cur === '우회전')),
      h(Box, { marginTop: 1 }, gap, key('S', cur === '후진'), gap),
      h(Box, { marginTop: 1 }, h(Text, null, `선속 `), h(Text, { color: 'yellow' }, t.lin.toFixed(2)), h(Text, null, ` m/s    각속 `), h(Text, { color: 'yellow' }, t.ang.toFixed(2)), h(Text, null, ' rad/s')),
      h(Box, { marginTop: 1 }, h(Text, { color: cur === 'stop' ? 'gray' : 'greenBright', bold: true }, cur === 'stop' ? '■ 정지' : `▶ 발행 중 · ${cur} · -r 10 Hz`))));
}
