// 🩺 프리플라이트 / 헬스 체크 — 기대 조건(토픽·Hz·노드·서비스)을 현재 그래프 대비 ✓/✗ 로.
// arm/비행 전 "스택 준비됐나?" 한눈에. 체크는 ~/.rdash_preflight.json 에서 로드.
import { h } from '../../react.js';
import { Box, Text, useInput } from 'ink';
import { useDashboard } from '../../store.js';
import { evalCheck, PREFLIGHT_PATH } from '../../../../shared/preflight.js';
import { pad } from '../../../../shared/util.js';

export function Preflight() {
  const d = useDashboard();
  const checks = d.preflight;
  const items = d.topics || [];
  useInput((ch, key) => { if (key.escape || ch === 'q' || ch === 'F') d.setPreflightOpen(false); }, { isActive: !!process.stdin.isTTY });

  const results = checks.map((c) => ({ c, r: evalCheck(c, items) }));
  const passed = results.filter((x) => x.r.ok).length;
  const w = Math.max(30, (d.cols || 100) - 4);
  const allOk = checks.length && passed === checks.length;
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: allOk ? 'green' : 'yellow', paddingX: 1, width: w + 2 },
    h(Text, { color: allOk ? 'green' : 'yellow', bold: true },
      ` 🩺 Preflight  ${passed}/${checks.length} ${allOk ? '✓ READY' : ''} — Esc 닫기 `),
    ...(checks.length
      ? results.slice(0, 14).map((x, i) =>
          h(Text, { key: i, color: x.r.ok ? 'green' : 'red' },
            ` ${x.r.ok ? '✓' : '✗'} ${pad(`${x.c.type} ${x.c.name}`, w - 22)} ${x.r.detail}`))
      : [h(Text, { key: 'e', dimColor: true }, ` (체크 없음) ${PREFLIGHT_PATH} 에 정의: {"checks":[{"type":"topic","name":"/livox/imu","minHz":150}]} `)]));
}
