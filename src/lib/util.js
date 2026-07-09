// 순수 유틸 — UI/ROS 비의존. 문자열 패딩, 스파크라인, 퍼지 매치 등.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pad = (s, n) => (String(s) + ' '.repeat(Math.max(0, n))).slice(0, n);
export const padL = (s, n) => (' '.repeat(Math.max(0, n)) + String(s)).slice(-n);

export const LEFT_W = 40;                       // 왼쪽 트리 패널 폭
export const RATES = [1, 2, 5, 10, 15, 20, 30, 60];   // 선택 가능한 최대 렌더 rate(Hz)
export const MIN_COLS = 65;                     // 이 아래로는 오른쪽 패널이 넘쳐 깨짐
export const MIN_ROWS = 10;                     // 이 아래로는 세로가 부족

// ── Hz 스파크라인 — 최근 히스토리를 블록문자 미니그래프로 ──────────────────────
const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(arr, w = 5) {
  if (!arr || !arr.length) return ' '.repeat(w);
  const recent = arr.slice(-w);
  const max = Math.max(...recent, 1);
  const s = recent.map((v) => v <= 0 ? '·' : SPARK[clamp(Math.round(v / max * (SPARK.length - 1)), 0, SPARK.length - 1)]).join('');
  return padL(s, w);
}

// 퍼지(서브시퀀스) 매치 — needle 문자들이 순서대로 hay 에 들어있으면 true. 둘 다 소문자 가정.
export function fuzzy(needle, hay) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

// 셸 인용부호 이스케이프(작은따옴표 안전)
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
