// 플롯(plot.py)에 필요한 파이썬 패키지 자동 설치 — 시작 시 없는 것만 pip 로 설치한다.
// 대체 화면 진입 전에 호출(설치 로그가 TUI 위에 찍히지 않도록). 실패해도 TUI 는 계속 뜬다
// (plot.py 가 import 를 방어하므로 플롯만 비활성).
//   끄기: RDASH_NO_AUTOPIP=1 · 파이썬 지정: RDASH_PYTHON=python3.10
import { execFileSync } from 'child_process';

// [import 이름, pip 이름] — requirements.txt 와 동일 목록(이름 매핑만 다름: yaml↔PyYAML).
const MODS = [['numpy', 'numpy'], ['matplotlib', 'matplotlib'], ['yaml', 'PyYAML']];

export function ensurePyDeps() {
  if (process.env.RDASH_NO_AUTOPIP === '1') return;
  const py = process.env.RDASH_PYTHON || 'python3';
  const missing = [];
  for (const [imp, pip] of MODS) {
    try { execFileSync(py, ['-c', `import ${imp}`], { stdio: 'ignore' }); }
    catch { missing.push(pip); }
  }
  if (!missing.length) return;   // 빠른 경로: 다 있으면 조용히 통과(설치된 뒤엔 매번 무동작)

  process.stderr.write(`RDash: 플롯용 파이썬 패키지 설치 시도 — ${missing.join(', ')}  (끄기: RDASH_NO_AUTOPIP=1)\n`);
  // 환경별로 막히는 경우가 있어 순차 폴백: 기본 → --user → --break-system-packages(PEP668).
  const base = ['-m', 'pip', 'install', '--disable-pip-version-check', '-q'];
  const attempts = [base, [...base, '--user'], [...base, '--break-system-packages']];
  for (const flags of attempts) {
    try { execFileSync(py, [...flags, ...missing], { stdio: 'inherit' }); return; }
    catch { /* 다음 방식 시도 */ }
  }
  process.stderr.write('RDash: 자동 설치 실패 — 수동으로 `pip install -r requirements.txt` (플롯 없이 계속 실행)\n');
}
