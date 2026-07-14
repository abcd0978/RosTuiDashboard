// splitLog — 자식 프로세스 출력 정규화. 깨지면 Jobs 오버레이 프레임이 터진다.
//   실행: node test/test_joblog.mjs
import assert from 'assert';
import { splitLog } from '../backend/jobs.js';

const ESC = '\x1b';

// \r 은 줄을 나눈다 — 안 나누면 터미널 커서가 줄 앞으로 튀어 테두리를 덮어쓴다(진행바가 그런다).
assert.deepStrictEqual(splitLog('[ 10%]\r[ 50%]\r[100%]\n'), ['[ 10%]', '[ 50%]', '[100%]']);

// ANSI CSI 는 지운다 — 폭 계산을 망치고 웹에선 글자로 보인다.
assert.deepStrictEqual(splitLog(`${ESC}[0;32m[INFO]${ESC}[0m started`), ['[INFO] started']);

// 단독 ESC · NUL · BEL 같은 제어문자도 지운다.
assert.deepStrictEqual(splitLog(`a${ESC}b\x00c\x07d`), ['abcd']);

// 탭은 공백으로 편다 — 터미널은 8 칸, 폭 계산은 1 칸으로 세서 박스를 넘겼다.
assert.deepStrictEqual(splitLog('name\tvalue'), ['name    value']);

// CRLF 는 한 번만 나눈다(빈 줄이 끼면 안 된다).
assert.deepStrictEqual(splitLog('a\r\nb\r\n'), ['a', 'b']);

// 한글은 그대로 둔다 — 자르는 건 렌더러 몫(Ink 의 wrap='truncate-end' 가 표시 폭으로 자른다).
assert.deepStrictEqual(splitLog('노드 시작됨'), ['노드 시작됨']);

console.log('✅ splitLog 6/6 통과');
// backend/jobs.js → telemetry.js 가 rosbridge 워치독 타이머를 건다. 명시적으로 나가지 않으면 안 끝난다.
process.exit(0);
