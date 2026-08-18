// rosbridge_server 자동 설치 — 그래프/echo 가 전부 rosbridge 를 통하므로 없으면 rdash 는 빈 화면이다.
// 시작 시 /opt/ros/<distro>/share/rosbridge_server 가 없으면 apt 로 깐다(pydeps.js 와 같은 방식). 끄기: RDASH_NO_AUTOAPT=1
// 반환: 설치를 시도했으면 true(호출자가 로그를 보여준 뒤 진행하도록).
import { existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';

export function ensureRosbridgePkg() {
  if (process.env.RDASH_NO_AUTOAPT === '1') return false;
  let distros = [];
  try { distros = readdirSync('/opt/ros'); } catch { return false; }   // ROS 미설치 — 우리 소관 아님
  const distro = process.env.ROS_DISTRO || distros[0];
  if (!distro || existsSync(`/opt/ros/${distro}/share/rosbridge_server`)) return false;   // 빠른 경로
  const pkg = `ros-${distro}-rosbridge-server`;
  // root 면 sudo 없이 · TTY 면 sudo(비번 프롬프트) · 비TTY(TUI 가 띄운 백엔드 등)면 sudo -n(프롬프트에 매달리지 않게)
  const sudo = process.getuid?.() === 0 ? [] : process.stdin.isTTY ? ['sudo'] : ['sudo', '-n'];
  process.stderr.write(`RDash: rosbridge_server 없음 — ${pkg} 설치  (끄기: RDASH_NO_AUTOAPT=1)\n\n`);
  try { execFileSync(sudo[0] || 'apt-get', [...sudo.slice(1), ...(sudo.length ? ['apt-get'] : []), 'install', '-y', pkg], { stdio: 'inherit' }); }
  catch { process.stderr.write(`\nRDash: 자동 설치 실패 — 수동으로 \`sudo apt-get install ${pkg}\`\n`); }
  return true;
}
