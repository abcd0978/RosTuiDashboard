/* 🗺 GPS 지도 — NavSatFix lat/lon 궤적을 캔버스에 플롯(외부 타일 없이, 오프라인/CSP 안전). */

import { el } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { openModal, setModalSub } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';

export function map(it) {
  const topic = it ? it.name : (state.items.find((i) => (i.ty || '').includes('NavSatFix')) || {}).name;
  if (!topic) { openModal('🗺 GPS 지도', el('p', { class: 'hint' }, 'NavSatFix 토픽이 없습니다.')); return; }
  const cv = el('canvas', { width: 900, height: 460, style: 'width:100%;height:460px;background:#0d1116;border:1px solid var(--line);border-radius:6px' });
  const info = el('div', { class: 'hint', style: 'margin-top:6px' });
  openModal('🗺 GPS 지도 — ' + topic, el('div', {}, el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'NavSatFix 위경도 궤적 (외부 타일 없이 로컬 렌더)'), cv, info));
  const track = [];
  let cur = null;
  setModalSub(openStream('/echo?topic=' + encodeURIComponent(topic), (d) => {
    const text = JSON.parse(d);
    const g = {};
    for (const m of text.matchAll(/^(latitude|longitude|altitude):\s*(-?\d+\.?\d*)/gm)) g[m[1]] = parseFloat(m[2]);
    if (g.latitude == null || g.longitude == null) return;
    cur = g;
    track.push([g.longitude, g.latitude]);
    if (track.length > 2000) track.shift();
    info.textContent = `lat ${g.latitude.toFixed(6)} · lon ${g.longitude.toFixed(6)} · alt ${(g.altitude ?? 0).toFixed(1)} m · ${track.length} pts`;
    draw();
  }));
  function draw() {
    const ctx = cv.getContext('2d'), W = cv.width = cv.clientWidth, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (track.length < 2) return;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const [x, y] of track) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    const pad = 40, latMid = (mny + mxy) / 2, sx = (mxx - mnx) || 1e-6, sy = (mxy - mny) || 1e-6;
    // 위도 보정(경도 축소) — 간이 등거리. 종횡비 유지.
    const scale = Math.min((W - 2 * pad) / (sx * Math.cos(latMid * Math.PI / 180)), (H - 2 * pad) / sy);
    const px = (x) => pad + (x - mnx) * Math.cos(latMid * Math.PI / 180) * scale;
    const py = (y) => H - pad - (y - mny) * scale;
    ctx.strokeStyle = '#232b36';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const gy = pad + (H - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke(); const gx = pad + (W - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - pad); ctx.stroke(); }
    ctx.strokeStyle = '#57c7d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    track.forEach(([x, y], i) => { const X = px(x), Y = py(y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke();
    if (cur) { ctx.fillStyle = '#e2c85a'; ctx.beginPath(); ctx.arc(px(cur.longitude), py(cur.latitude), 5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#8b97a7';
    ctx.font = '10px monospace';
    ctx.fillText(`${mny.toFixed(5)}..${mxy.toFixed(5)}°N`, pad, 14);
    ctx.fillText(`${mnx.toFixed(5)}..${mxx.toFixed(5)}°E`, pad, H - 8);
  }
}
