// 라인 단위 차등 출력기(diffing writer) — Ink 는 상태가 바뀌면 매 프레임 "전체 화면"을 다시 그린다
// (log-update 이 이전 줄을 전부 지우고 프레임 전체를 다시 씀). 그래서 pose 값 하나가 30Hz 로 바뀌면
// 그 아래(위)까지 모든 줄을 다시 전송·재래스터화한다.
//
// 우리는 대체 화면(alt screen) 전체를 소유하고 루트 높이를 rows-1 로 고정했으므로, 앱은 항상 화면
// 맨 위(1행)부터 시작한다. 이를 이용해 Ink 가 log-update 로 보내는 프레임을 가로채, 이전 프레임과
// 줄 단위로 비교하여 "바뀐 줄만" 절대좌표로 덮어쓴다. pose 갱신 시 실제로 다시 그리는 줄은 1~2줄뿐.
//
// RDASH_DIFF=0 이면 비활성(원래 process.stdout 그대로 사용).

// log-update 이 프레임 앞에 붙이는 eraseLines 접두(커서 위로/줄 지움/커서 왼쪽)만 골라 제거.
// 프레임 본문은 SGR 색코드(\x1b[..m)와 문자로 시작하므로 여기에 걸리지 않는다.
const ERASE_PREFIX = /^(?:\x1b\[2K|\x1b\[[0-9]*A|\x1b\[[0-9]*G)+/;

export function createDiffStdout(real) {
  let prev = [];   // 이전 프레임의 화면 줄들

  const eraseAll = () => {
    let b = '';
    for (let i = 0; i < prev.length; i++) b += `\x1b[${i + 1};1H\x1b[2K`;
    if (b) real.write(b);
    prev = [];
  };

  const renderDiff = (lines) => {
    let out = '';
    const n = Math.max(lines.length, prev.length);
    for (let i = 0; i < n; i++) {
      const nl = lines[i];
      if (nl === prev[i]) continue;                 // 안 바뀐 줄은 건드리지 않음(핵심)
      if (nl === undefined) out += `\x1b[${i + 1};1H\x1b[2K`;   // 줄어든 줄 지움
      else out += `\x1b[${i + 1};1H` + nl + '\x1b[0m\x1b[K';    // 제자리 덮어쓰기 + 잔여 정리
    }
    if (out) real.write(out);
    prev = lines;
  };

  const handleWrite = (data, enc, cb) => {
    const done = typeof enc === 'function' ? enc : cb;
    try {
      const s = typeof data === 'string' ? data : data.toString();
      if (s.includes('\x1b[2J')) { real.write(s); prev = []; if (done) done(); return true; }  // 전체 클리어는 통과
      const body = s.replace(ERASE_PREFIX, '');
      if (body === '') eraseAll();
      else {
        const frame = body.endsWith('\n') ? body.slice(0, -1) : body;
        renderDiff(frame.split('\n'));
      }
    } catch { real.write(data); }
    if (done) done();
    return true;
  };

  // write 만 가로채고 나머지(columns/rows/on/off…)는 실제 stdout 으로 위임.
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'write') return handleWrite;
      const v = real[prop];
      return typeof v === 'function' ? v.bind(real) : v;
    },
    set(_t, prop, val) { real[prop] = val; return true; },
  });
}
