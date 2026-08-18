// pubdefaults.js — 프리셋이 필드에 입혀지고(중첩 경로 포함) 없는 경로는 무시되는가.
import assert from 'assert';
import { applyPreset } from '../shared/pubdefaults.js';
import { flattenSkeleton, buildYaml } from '../shared/msgform.js';

const fields = flattenSkeleton({ data: '' });
assert.strictEqual(buildYaml(applyPreset(fields, { data: 'set brightness 0' })), '{data: "set brightness 0"}');
assert.strictEqual(buildYaml(applyPreset(fields, null)), buildYaml(fields));

const twist = flattenSkeleton({ linear: { x: 0, y: 0 }, angular: { z: 0 } });
const out = buildYaml(applyPreset(twist, { 'linear.x': 0.5, 'nope.q': 1 }));
assert.ok(out.includes('x: 0.5') && !out.includes('nope'), out);
console.log('ok');
