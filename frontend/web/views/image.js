/* 🖼 카메라 — base64 JPEG SSE + 어노테이션(검출 박스/점/원/텍스트) + 보정(CameraInfo 주점·레티클) 오버레이.
   Foxglove 이미지 패널 대응: 원본 이미지 픽셀 좌표계로 온 주석을 표시 크기에 맞춰 스케일 렌더. */

import { el } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { openModal, setModalSub } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';

export function image(it) {
  const topic = it ? it.name : (state.items.find((i) => /CompressedImage|sensor_msgs\/msg\/Image/.test(i.ty || '')) || {}).name;
  if (!topic) { openModal('🖼 카메라', el('p', { class: 'hint' }, '이미지 토픽이 없습니다.')); return; }
  const annTopics = state.items.filter((i) => /Detection2D(Array)?|ImageAnnotations/.test(i.ty || '')).map((i) => i.name);
  const infoTopics = state.items.filter((i) => /CameraInfo/.test(i.ty || '')).map((i) => i.name);
  const img = el('img', { style: 'display:block;max-width:100%;background:#0d1116;image-rendering:auto' });
  const ov = el('canvas', { style: 'position:absolute;left:0;top:0;pointer-events:none' });
  const zoomWrap = el('div', { style: 'position:relative;transform-origin:0 0' }, img, ov);
  const stage = el('div', { style: 'position:relative;display:inline-block;max-width:100%;overflow:hidden;border:1px solid var(--line);border-radius:6px;cursor:grab' }, zoomWrap);
  const off = document.createElement('canvas');
  const zoom = { s: 1, ox: 0, oy: 0 };
  let panning = null;
  const applyZoom = () => { zoomWrap.style.transform = `translate(${zoom.ox}px,${zoom.oy}px) scale(${zoom.s})`; };
  const info = el('div', { class: 'hint', style: 'margin-top:6px' }, '연결 중…');
  let n = 0, t0 = Date.now();
  let ann = { boxes: [], points: [], circles: [], texts: [] }, cam = null;
  let annES = null, camES = null;
  // ── 오버레이 렌더: 이미지 원본 픽셀(iw×ih) → 표시 크기(cw×ch) 스케일 ──
  function drawOverlay() {
    const cw = img.clientWidth, ch = img.clientHeight;
    if (!cw || !ch) return;
    if (ov.width !== cw) ov.width = cw;
    if (ov.height !== ch) ov.height = ch;
    const iw = (cam && cam.width) || img.naturalWidth || cw, ih = (cam && cam.height) || img.naturalHeight || ch;
    const kx = cw / iw, ky = ch / ih, ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.lineWidth = 2;
    ctx.font = '12px monospace';
    ctx.textBaseline = 'bottom';
    for (const b of ann.boxes) {
      const x = (b.cx - b.w / 2) * kx, y = (b.cy - b.h / 2) * ky, w = b.w * kx, h = b.h * ky;
      ctx.strokeStyle = '#6fd08c';
      ctx.strokeRect(x, y, w, h);
      const tag = (b.label || 'obj') + (b.score ? ' ' + (b.score * 100 | 0) + '%' : '');
      ctx.fillStyle = '#6fd08c';
      const tw = ctx.measureText(tag).width + 6;
      ctx.fillRect(x, y - 15, tw, 15);
      ctx.fillStyle = '#0d1116';
      ctx.fillText(tag, x + 3, y - 2);
    }
    for (const p of ann.points) { ctx.fillStyle = `rgb(${p[2]},${p[3]},${p[4]})`; ctx.beginPath(); ctx.arc(p[0] * kx, p[1] * ky, 3, 0, 7); ctx.fill(); }
    for (const c of ann.circles) { ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`; ctx.beginPath(); ctx.arc(c.x * kx, c.y * ky, c.d / 2 * kx, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#e2c85a';
    for (const t of ann.texts) ctx.fillText(t.t, t.x * kx, t.y * ky);
    if (cam && cam.K && cam.K.length === 9) {   // 보정: 주점(cx,cy) 십자 + 이미지 중심 대비
      const px = cam.K[2] * kx, py = cam.K[5] * ky;
      ctx.strokeStyle = '#c78ad2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 12, py);
      ctx.lineTo(px + 12, py);
      ctx.moveTo(px, py - 12);
      ctx.lineTo(px, py + 12);
      ctx.stroke();
      ctx.fillStyle = '#c78ad2';
      ctx.textBaseline = 'top';
      ctx.fillText('principal', px + 6, py + 4);
      ctx.textBaseline = 'bottom';
    }
  }
  const subAnn = (t) => {
    if (annES) { annES.close(); annES = null; }
    ann = { boxes: [], points: [], circles: [], texts: [] };
    drawOverlay();
    if (!t) return;
    annES = openStream('/annstream?topic=' + encodeURIComponent(t), (data) => { try { const o = JSON.parse(data); ann = { boxes: o.boxes || [], points: o.points || [], circles: o.circles || [], texts: o.texts || [] }; drawOverlay(); } catch (_) { /* */ } });
  };
  const subCam = (t) => {
    if (camES) { camES.close(); camES = null; }
    cam = null;
    drawOverlay();
    if (!t) return;
    camES = openStream('/caminfostream?topic=' + encodeURIComponent(t), (data) => { try { cam = JSON.parse(data); drawOverlay(); camInfoLbl.textContent = cam.K ? `K: fx=${cam.K[0].toFixed(0)} fy=${cam.K[4].toFixed(0)} cx=${cam.K[2].toFixed(0)} cy=${cam.K[5].toFixed(0)} · ${cam.model || ''} D=[${(cam.D || []).map((d) => d.toFixed(3)).join(', ')}]` : ''; } catch (_) { /* */ } });
  };
  // ── 소스 선택 컨트롤 ──
  const annSel = el('select', { style: 'font:11px monospace' });
  annSel.append(el('option', { value: '' }, '(없음)'));
  annTopics.forEach((t) => annSel.append(el('option', { value: t }, t)));
  annSel.onchange = () => subAnn(annSel.value);
  const camSel = el('select', { style: 'font:11px monospace' });
  camSel.append(el('option', { value: '' }, '(없음)'));
  infoTopics.forEach((t) => camSel.append(el('option', { value: t }, t)));
  camSel.onchange = () => subCam(camSel.value);
  const lbl = (t, node) => el('label', { style: 'display:inline-flex;align-items:center;gap:3px;margin-right:12px' }, el('span', { class: 'hint' }, t), node);
  const camInfoLbl = el('div', { class: 'hint', style: 'margin-top:4px;color:var(--purple,#c78ad2)' });
  const pixLbl = el('span', { class: 'hint', style: 'margin-left:12px;color:var(--cyan)' });
  const zreset = el('button', { class: 'act', style: 'padding:2px 7px', onclick: () => { zoom.s = 1; zoom.ox = 0; zoom.oy = 0; applyZoom(); } }, '1:1');
  const ctrl = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;margin-bottom:6px' }, lbl('어노테이션', annSel), lbl('CameraInfo', camSel), zreset, el('span', { class: 'hint', style: 'margin-left:8px' }, '휠=줌 · 드래그=이동'), pixLbl);
  openModal('🖼 카메라 — ' + topic, el('div', {}, ctrl, stage, info, camInfoLbl));
  // 줌/팬 + 픽셀값 — Foxglove 이미지 패널 대응(휠=커서 기준 줌, 드래그=이동, 이동 시 (x,y) rgb 표시).
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = e.deltaY < 0 ? 1.15 : 1 / 1.15, ns = Math.max(1, Math.min(16, zoom.s * f)), k = ns / zoom.s;
    zoom.ox = mx - (mx - zoom.ox) * k;
    zoom.oy = my - (my - zoom.oy) * k;
    zoom.s = ns;
    if (zoom.s <= 1.001) { zoom.s = 1; zoom.ox = 0; zoom.oy = 0; }
    applyZoom();
  }, { passive: false });
  stage.addEventListener('mousedown', (e) => { panning = { x: e.clientX, y: e.clientY }; stage.style.cursor = 'grabbing'; e.preventDefault(); });
  window.addEventListener('mouseup', () => { if (panning) { panning = null; stage.style.cursor = 'grab'; } });
  stage.addEventListener('mousemove', (e) => {
    if (panning) { zoom.ox += e.clientX - panning.x; zoom.oy += e.clientY - panning.y; panning = { x: e.clientX, y: e.clientY }; applyZoom(); return; }
    const r = img.getBoundingClientRect();
    if (!r.width || !off.width) { pixLbl.textContent = ''; return; }
    const px = Math.floor((e.clientX - r.left) / r.width * off.width), py = Math.floor((e.clientY - r.top) / r.height * off.height);
    if (px < 0 || py < 0 || px >= off.width || py >= off.height) { pixLbl.textContent = ''; return; }
    let rgb = '';
    try { const d = off.getContext('2d').getImageData(px, py, 1, 1).data; rgb = ` · rgb(${d[0]},${d[1]},${d[2]})`; } catch (_) { /* */ }
    pixLbl.textContent = `(${px}, ${py})${rgb}`;
  });
  const es = openStream('/imgstream?topic=' + encodeURIComponent(topic), (d) => { if (!d) return; img.src = 'data:image/jpeg;base64,' + d; n++; const fps = n / ((Date.now() - t0) / 1000); info.textContent = `${n} 프레임 · ${fps.toFixed(1)} fps`; drawOverlay(); });
  img.onload = () => { off.width = img.naturalWidth; off.height = img.naturalHeight; try { off.getContext('2d').drawImage(img, 0, 0); } catch (_) { /* */ } drawOverlay(); };
  if (annTopics[0]) { annSel.value = annTopics[0]; subAnn(annTopics[0]); }
  if (infoTopics[0]) { camSel.value = infoTopics[0]; subCam(infoTopics[0]); }
  setModalSub({ close: () => { es.close(); if (annES) annES.close(); if (camES) camES.close(); } });
}
