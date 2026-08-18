// 발행 프리셋 — 토픽별 "미리 채운 메시지" 목록. 비개발자(QA)가 메시지 구조를 몰라도 값만 고쳐 발행하게 한다.
// 출처: shared/pubdefaults.json(번들 — teleop 프리셋처럼 rdash 가 아는 스택은 여기 실어 배포) + ~/.rdash_pubdefaults.json(기기별,
// 같은 토픽이면 홈 파일이 이긴다). 대상 프로젝트 레포는 rdash 를 몰라도 된다.
// 형식: { "/topic": [ {preset}, ... ] } 또는 { "/topic": { "presets": [ {preset}, ... ], "reply": "/응답토픽" } }
//   preset = { "field.path": value, ... } — 첫 항목이 기본 프리필, 나머지는 폼에서 전환.
//   reply  = 지정하면 발행 후 폼을 닫지 않고 그 토픽의 최신 메시지를 폼 하단에 보여준다(명령→결과 토픽 쌍).
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const BUNDLED_PATH = join(dirname(fileURLToPath(import.meta.url)), 'pubdefaults.json');
export const PUBDEFAULTS_PATH = join(homedir(), '.rdash_pubdefaults.json');

export function loadPubDefaults() {
  const out = {};
  for (const f of [BUNDLED_PATH, PUBDEFAULTS_PATH]) {
    let d = null;
    try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }   // 없거나 깨진 파일은 무시
    for (const [topic, v] of Object.entries(d)) {
      const presets = Array.isArray(v) ? v : Array.isArray(v?.presets) ? v.presets : [];
      out[topic] = { presets, reply: (!Array.isArray(v) && typeof v?.reply === 'string') ? v.reply : null };
    }
  }
  return out;   // topic → { presets, reply }
}

// 프리셋(경로→값)을 폼 필드에 입힌다 — value 로 넣어 사용자가 이어서 고칠 수 있게(def 는 자리표시자라 첫 입력에 지워진다).
export function applyPreset(fields, preset) {
  if (!preset || typeof preset !== 'object') return fields;
  const str = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));
  return fields.map((f) => (f.path in preset ? { ...f, value: str(preset[f.path]) } : f));
}
