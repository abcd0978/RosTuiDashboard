// 대체 화면 버퍼(alt screen) 진입/복원 — TUI 종료 시 원래 터미널 내용 보존.
const ALT_ON = '\x1b[?1049h\x1b[2J\x1b[H';
const ALT_OFF = '\x1b[?1049l';
const isTTY = !!process.stdout.isTTY;
let restored = false;

export function enterAltScreen() {
  if (isTTY) process.stdout.write(ALT_ON);
}
export function restoreScreen() {
  if (isTTY && !restored) { restored = true; process.stdout.write(ALT_OFF); }
}
// Ink render 의 waitUntilExit 프라미스를 받아 화면 복원 + 프로세스 종료를 배선한다.
//
// 언마운트된 뒤 반드시 직접 exit 해야 한다. TUI 가 백엔드 API 클라이언트가 되면서 lib/api.js 가
// /ws 웹소켓을 열고 재연결 타이머를 돌리고, store 는 잡을 1 초마다 폴링한다. 이 핸들들이 이벤트
// 루프를 붙잡고 있어서, Ink 가 언마운트돼도(= Ctrl+C, q) 화면만 돌아오고 프로세스는 영원히 남는다.
// 실제로 그렇게 안 죽는 TUI 가 떠 있었다.
export function bindExit(waitPromise) {
  const done = () => { restoreScreen(); process.exit(0); };   // 'exit' 핸들러들이 나머지 정리를 한다
  waitPromise.then(done, done);
  process.on('exit', restoreScreen);
}
