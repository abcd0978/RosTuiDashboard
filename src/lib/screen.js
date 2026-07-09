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
// Ink render 의 waitUntilExit 프라미스를 받아 화면 복원/종료 시그널을 배선한다.
export function bindExit(waitPromise) {
  waitPromise.then(restoreScreen, restoreScreen);
  process.on('exit', restoreScreen);
  process.on('SIGTERM', () => process.exit(0));
}
