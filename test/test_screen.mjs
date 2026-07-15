// screen.js — 종료 시 마우스 트래킹을 끄는가. 안 끄면 RDash 종료 후 마우스 움직임이 "<35;22;1M" 로 샌다.
import assert from 'assert';
process.stdout.isTTY = true;   // isTTY 는 모듈 로드 시 캡처된다 → import 전에 세팅

const rec = [];
const real = process.stdout.write.bind(process.stdout);
process.stdout.write = (s, ...a) => { rec.push(String(s)); return true; };

const { enterAltScreen, restoreScreen } = await import('/root/RosTuiDashboard/frontend/tui/lib/screen.js');
enterAltScreen();
restoreScreen();

process.stdout.write = real;
const out = rec.join('');

// SGR 마우스 모드(1006) 를 반드시 꺼야 한다 — "<...M" 리포트를 내는 게 이 모드다.
assert.ok(out.includes('\x1b[?1006l'), '1006l(SGR 끄기) 누락 → 마우스 리포트가 계속 샌다');
// ink-mouse 가 켜는 나머지 모드도 전부 끈다.
for (const m of ['1000', '1002', '1003', '1015']) assert.ok(out.includes(`\x1b[?${m}l`), `${m}l 누락`);
// alt-screen 복원도 여전히 한다.
assert.ok(out.includes('\x1b[?1049l'), 'alt-screen 복원 누락');
// 마우스 끄기가 alt-screen 나가기보다 먼저(같은 write 안).
assert.ok(out.indexOf('\x1b[?1006l') < out.indexOf('\x1b[?1049l'), '순서 뒤바뀜');
// 두 번 호출해도 한 번만 쓴다(restored 가드).
rec.length = 0;
process.stdout.write = () => true;
restoreScreen();
process.stdout.write = real;
assert.strictEqual(rec.length, 0, '중복 복원 — 가드 깨짐');

console.log('✅ screen 복원 6/6 통과 — 종료 시 1000/1002/1003/1006/1015 전부 끔');
process.exit(0);
