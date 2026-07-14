// 발행 폼 모델 — 메시지 스켈레톤(JSON 중첩 기본값)을 "필드명 ↦ 값" 리스트로 펼치고,
// 사용자가 채운 값을 다시 YAML(flow) 메시지 문자열로 조립한다.
// 목적: 사용자가 "{linear: {x: 0.0, ...}}" 구조를 통째로 외워 치지 않고, 필드별로 값만 입력하게 함.

// 스켈레톤(중첩 객체) → 리프 필드 배열 [{path:'linear.x', keys:['linear','x'], def, kind}]
// kind: 'num' | 'bool' | 'str' | 'raw'(배열 등, 있는 그대로 편집)
export function flattenSkeleton(obj) {
  const out = [];
  const walk = (node, keys) => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      const ks = Object.keys(node);
      // 빈 중첩 서브메시지는 그대로 raw 리프. 루트가 비면(std_srvs/Empty·Trigger 요청 등) 필드 0개다
      // — 이름 없는 리프를 만들면 buildYaml 이 {undefined: …} 를 뱉는다.
      if (ks.length === 0) { if (keys.length) out.push(leaf(keys, node, 'raw')); return; }
      for (const k of ks) walk(node[k], [...keys, k]);
      return;
    }
    const kind = Array.isArray(node) ? 'raw'
      : typeof node === 'number' ? 'num'
        : typeof node === 'boolean' ? 'bool' : 'str';
    out.push(leaf(keys, node, kind));
  };
  walk(obj, []);
  return out;
}

function leaf(keys, def, kind) {
  const dv = kind === 'raw' ? (Array.isArray(def) ? JSON.stringify(def) : String(def))
    : kind === 'str' ? String(def)
      : String(def);
  return { path: keys.join('.'), keys, def: dv, kind };
}

// 필드값(문자열) 하나를 YAML flow 토큰으로 — 숫자/불리언은 그대로, 문자열은 따옴표.
function fmt(val, kind) {
  const v = val == null ? '' : String(val);
  if (kind === 'num') return v.trim() === '' ? '0' : v.trim();
  if (kind === 'bool') return /^(true|1)$/i.test(v.trim()) ? 'true' : 'false';
  if (kind === 'raw') return v.trim() === '' ? '[]' : v.trim();
  // str — 이미 따옴표로 감쌌으면 그대로, 아니면 JSON 문자열로 안전하게 인용
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t;
  return JSON.stringify(v);
}

// 필드 배열 → flow YAML 메시지 문자열. 중첩은 fields 의 keys 로 복원.
export function buildYaml(fields) {
  const root = {};
  for (const f of fields) {
    let node = root;
    for (let i = 0; i < f.keys.length - 1; i++) {
      const k = f.keys[i];
      if (!node[k] || typeof node[k] !== 'object' || node[k].__leaf) node[k] = {};
      node = node[k];
    }
    node[f.keys[f.keys.length - 1]] = { __leaf: true, tok: fmt(f.value ?? f.def, f.kind) };
  }
  const ser = (node) => {
    if (node && node.__leaf) return node.tok;
    const parts = Object.keys(node).map((k) => `${k}: ${ser(node[k])}`);
    return `{${parts.join(', ')}}`;
  };
  return ser(root);
}
