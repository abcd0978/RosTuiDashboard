/* 🐢 2D 포즈 뷰 — geometry_msgs/Pose2D 의 x·y 궤적과 heading 을 위에서 내려다본 캔버스에 그린다. */

import { el } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { openModal, setModalSub } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';

export function turtle(it) {
  const topic = it ? it.name : (state.items.find((i) => (i.ty || '').includes('Pose2D')) || {}).name;
  if (!topic) { openModal('🐢 2D 포즈 뷰', el('p', { class: 'hint' }, 'Pose2D 토픽이 없습니다.')); return; }
  const track = [];
  const cv = el('canvas', { width: 900, height: 460, style: 'width:100%;height:460px;background:#0d1116;border:1px solid var(--line);border-radius:6px' });
  const info = el('span', { class: 'hint' });
  const clearBtn = el('button', { class: 'act', onclick: () => { track.length = 0; draw(); } }, '궤적 지우기');
  const infoRow = el('div', { style: 'margin-top:6px;display:flex;align-items:center;gap:10px' }, info, clearBtn);
  openModal('🐢 2D 포즈 뷰 — ' + topic, el('div', {}, el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'Pose2D x·y 궤적과 heading (위에서 내려다본 뷰)'), cv, infoRow));
  setModalSub(openStream('/echo?topic=' + encodeURIComponent(topic), (d) => {
    const text = JSON.parse(d);
    const g = {};
    for (const m of text.matchAll(/^(x|y|theta):\s*(-?\d+\.?\d*(?:e[-+]?\d+)?)/gm)) g[m[1]] = parseFloat(m[2]);
    if (g.x == null || g.y == null) return;
    const theta = g.theta ?? 0;
    track.push([g.x, g.y, theta]);
    if (track.length > 2000) track.shift();
    info.textContent = `x ${g.x.toFixed(3)} · y ${g.y.toFixed(3)} · θ ${theta.toFixed(3)} rad (${(theta * 180 / Math.PI).toFixed(1)}°) · ${track.length} pts`;
    draw();
  }));
  function draw() {
    const ctx = cv.getContext('2d'), W = cv.width = cv.clientWidth, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!track.length) return;
    // 경계 — 항상 원점(0,0)을 포함, 각 축 최소 스팬 2.0 보장(시작 시 (0,0) 한 점뿐이라 스팬 0 방지)
    let mnx = 0, mxx = 0, mny = 0, mxy = 0;
    for (const [x, y] of track) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    const MIN_SPAN = 2.0;
    let sx = mxx - mnx, sy = mxy - mny;
    if (sx < MIN_SPAN) { const mid = (mnx + mxx) / 2; mnx = mid - MIN_SPAN / 2; mxx = mid + MIN_SPAN / 2; sx = MIN_SPAN; }
    if (sy < MIN_SPAN) { const mid = (mny + mxy) / 2; mny = mid - MIN_SPAN / 2; mxy = mid + MIN_SPAN / 2; sy = MIN_SPAN; }
    const pad = 40;
    // 등축척 — x/y 동일 스케일이라야 정사각 경로가 늘어나지 않는다
    const scale = Math.min((W - 2 * pad) / sx, (H - 2 * pad) / sy);
    const px = (x) => pad + (x - mnx) * scale;
    const py = (y) => H - pad - (y - mny) * scale;
    ctx.strokeStyle = '#232b36';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const gy = pad + (H - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke(); const gx = pad + (W - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - pad); ctx.stroke(); }
    ctx.strokeStyle = '#3a4658';
    ctx.lineWidth = 1;
    if (mnx <= 0 && 0 <= mxx) { const X = px(0); ctx.beginPath(); ctx.moveTo(X, pad); ctx.lineTo(X, H - pad); ctx.stroke(); }
    if (mny <= 0 && 0 <= mxy) { const Y = py(0); ctx.beginPath(); ctx.moveTo(pad, Y); ctx.lineTo(W - pad, Y); ctx.stroke(); }
    if (track.length >= 2) {
      ctx.strokeStyle = '#57c7d4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      track.forEach(([x, y], i) => { const X = px(x), Y = py(y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    const [lx, ly, ltheta] = track[track.length - 1];
    ctx.save();
    ctx.translate(px(lx), py(ly));
    ctx.rotate(-ltheta);
    ctx.fillStyle = '#e2c85a';
    ctx.strokeStyle = '#0d1116';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#8b97a7';
    ctx.font = '10px monospace';
    ctx.fillText(`y: ${mny.toFixed(2)}..${mxy.toFixed(2)}`, pad, 14);
    ctx.fillText(`x: ${mnx.toFixed(2)}..${mxx.toFixed(2)}`, pad, H - 8);
  }
}
