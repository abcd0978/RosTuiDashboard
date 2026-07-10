// 플롯(plot.py)에 필요한 파이썬 패키지 자동 설치 — 시작 시 없는 것만 pip 로 설치한다.
// 대체 화면 진입 전에 호출(설치 로그가 TUI 위에 찍히지 않도록). 실패해도 TUI 는 계속 뜬다
// (plot.py 가 import 를 방어하므로 플롯만 비활성).
//   끄기: RDASH_NO_AUTOPIP=1 · 파이썬 지정: RDASH_PYTHON=python3.10
import { execFileSync } from 'child_process';
import { readSync } from 'fs';

// [import 이름, pip 이름] — requirements.txt 와 동일 목록(이름 매핑만 다름: yaml↔PyYAML).
const MODS = [['numpy', 'numpy'], ['matplotlib', 'matplotlib'], ['yaml', 'PyYAML']];

// 설치 로그를 사용자가 확인한 뒤 TUI 로 넘어가도록 Enter 대기(대체 화면 진입 전).
function waitForEnter() {
  if (!process.stdin.isTTY) return;
  process.stderr.write('\n위 설치 로그 확인 후 Enter 를 누르면 RDash 가 시작됩니다… ');
  try {
    const buf = Buffer.alloc(1);
    // 캐노니컬 모드라 Enter 까지 블록. 개행까지 읽어 남은 입력이 Ink 로 새지 않게 한다.
    while (readSync(0, buf, 0, 1, null) > 0 && buf[0] !== 0x0a) { /* consume line */ }
  } catch { /* 논블로킹/비TTY 등 — 그냥 진행 */ }
  process.stderr.write('\n');
}

export function ensurePyDeps() {
  if (process.env.RDASH_NO_AUTOPIP === '1') return;
  const py = process.env.RDASH_PYTHON || 'python3';
  const missing = [];
  for (const [imp, pip] of MODS) {
    try { execFileSync(py, ['-c', `import ${imp}`], { stdio: 'ignore' }); }
    catch { missing.push(pip); }
  }
  if (!missing.length) return;   // 빠른 경로: 다 있으면 조용히 통과(설치된 뒤엔 매번 무동작)

  process.stderr.write(`RDash: 플롯용 파이썬 패키지 설치 — ${missing.join(', ')}  (끄기: RDASH_NO_AUTOPIP=1)\n\n`);
  // 환경별로 막히는 경우가 있어 순차 폴백: 기본 → --user → --break-system-packages(PEP668).
  // -q 는 붙이지 않는다(설치 로그를 그대로 보여주기 위함).
  const base = ['-m', 'pip', 'install', '--disable-pip-version-check'];
  const attempts = [base, [...base, '--user'], [...base, '--break-system-packages']];
  let ok = false;
  for (const flags of attempts) {
    try { execFileSync(py, [...flags, ...missing], { stdio: 'inherit' }); ok = true; break; }
    catch { /* 다음 방식 시도 */ }
  }
  if (!ok) process.stderr.write('\nRDash: 자동 설치 실패 — 수동으로 `pip install -r requirements.txt` (플롯 없이 계속 실행)\n');
  waitForEnter();   // 로그를 남겨두고, 사용자가 Enter 를 누르면 대체 화면(TUI) 진입
}
