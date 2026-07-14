// 프리플라이트 체크 정의 로드 — 프로젝트별로 ~/.rdash_preflight.json 에 기대 조건을 적어둔다.
// 형식: { "checks": [ {type:"topic", name, minHz?}, {type:"node", name}, {type:"service", name} ] }
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const PREFLIGHT_PATH = join(homedir(), '.rdash_preflight.json');

export function loadPreflight() {
  try {
    const d = JSON.parse(readFileSync(PREFLIGHT_PATH, 'utf8'));
    return Array.isArray(d.checks) ? d.checks : [];
  } catch {
    return [];
  }
}

// 현재 그래프(items) 대비 체크 평가 → {ok, detail}
export function evalCheck(c, items) {
  if (c.type === 'topic') {
    const it = items.find((i) => i.kind === 'topic' && i.name === c.name);
    if (!it) return { ok: false, detail: '없음' };
    if (c.minHz != null && (it.hz || 0) < c.minHz) return { ok: false, detail: `hz ${it.hz} < ${c.minHz}` };
    return { ok: true, detail: `hz ${it.hz}` };
  }
  if (c.type === 'node' || c.type === 'service') {
    return items.some((i) => i.kind === c.type && i.name === c.name) ? { ok: true, detail: 'up' } : { ok: false, detail: '없음' };
  }
  return { ok: false, detail: `unknown type '${c.type}'` };
}
