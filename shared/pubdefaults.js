// 발행 프리셋 — 토픽별 "미리 채운 메시지" 목록. 비개발자(QA)가 메시지 구조를 몰라도 값만 고쳐 발행하게 한다.
// 파일: ~/.rdash_pubdefaults.json + 발견된 워크스페이스마다 <ws>/rdash_pubdefaults.json(프로젝트가 레포에 실어 배포).
// 형식: { "/topic": [ {preset}, ... ] } 또는 { "/topic": { "presets": [ {preset}, ... ], "reply": "/응답토픽" } }
//   preset = { "field.path": value, ... } — 첫 항목이 기본 프리필, 나머지는 폼에서 전환.
//   reply  = 지정하면 발행 후 폼을 닫지 않고 그 토픽의 최신 메시지를 폼 하단에 보여준다(명령→결과 토픽 쌍).
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { discoverOverlays } from './overlays.js';

export function loadPubDefaults() {
  const files = new Set([join(homedir(), '.rdash_pubdefaults.json')]);
  for (const sb of discoverOverlays()) files.add(join(dirname(dirname(sb)), 'rdash_pubdefaults.json'));   // <ws>/{devel,install}/setup.bash → <ws>
  const out = {};
  for (const f of files) {
    let d = null;
    try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }   // 없거나 깨진 파일은 무시
    for (const [topic, v] of Object.entries(d)) {
      const cur = out[topic] || (out[topic] = { presets: [], reply: null });
      cur.presets.push(...(Array.isArray(v) ? v : Array.isArray(v?.presets) ? v.presets : []));
      if (!Array.isArray(v) && typeof v?.reply === 'string') cur.reply = v.reply;
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
