/* 📈 PlotJuggler 스타일 — 다중 동기 플롯 · 여러 토픽 커브 · 공유 시간축/커서 · 줌/팬 · 변환 · 통계. */

import { $, el, api, SNAP } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { openModal, setModalSub, toast } from '../lib/modal.js';
import { openStream } from '../lib/stream.js';
import { numeric } from '../panels/value.js';

export function plotlab() {
  const PAL = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2', '#e06a6a', '#6f9be0', '#d98a4b', '#7ad2b8'];
  const S = { es: {}, series: {}, fields: {}, bag: new Set(), t0: Date.now() };
  const sub = (topic) => {
    if (S.es[topic] || S.bag.has(topic)) return;
    S.es[topic] = openStream('/echo?topic=' + encodeURIComponent(topic), (d) => {
      let text;
      try { text = JSON.parse(d); } catch (_) { return; }
      const nums = numeric(text), t = (Date.now() - S.t0) / 1000;
      S.fields[topic] = Object.keys(nums);
      for (const [k, v] of Object.entries(nums)) { const key = topic + ' ' + k; (S.series[key] || (S.series[key] = [])).push([t, v]); if (S.series[key].length > 4000) S.series[key].shift(); }
    });
  };
  const view = { W: 10, follow: true, tEnd: 0 };
  const plots = [];
  let colorI = 0, cursorT = null;
  const TF = { raw: '원값', d1: 'd/dt', d2: 'd²/dt²', d3: 'd³/dt³', i1: '∫dt', i2: '∫∫dt', abs: '|x|', movavg: '이동평균' };
  const derivOnce = (d) => { const o = []; for (let i = 1; i < d.length; i++) { const dt = d[i][0] - d[i - 1][0] || 1e-6; o.push([d[i][0], (d[i][1] - d[i - 1][1]) / dt]); } return o; };
  const integOnce = (d) => { const o = []; let a = 0; for (let i = 1; i < d.length; i++) { a += (d[i][1] + d[i - 1][1]) / 2 * (d[i][0] - d[i - 1][0]); o.push([d[i][0], a]); } return o; };
  const applyT = (data, tf) => {
    if (!data || data.length < 2 || tf === 'raw') return data || [];
    if (tf[0] === 'd') { let r = data; const n = +tf[1] || 1; for (let k = 0; k < n && r.length > 1; k++) r = derivOnce(r); return r; }   // n차 미분
    if (tf[0] === 'i') { let r = data; const n = +tf[1] || 1; for (let k = 0; k < n && r.length > 1; k++) r = integOnce(r); return r; }   // n차 적분
    if (tf === 'abs') return data.map(([t, v]) => [t, Math.abs(v)]);
    if (tf === 'movavg') { const n = 12, q = []; let s = 0; const o = []; for (const [t, v] of data) { q.push(v); s += v; if (q.length > n) s -= q.shift(); o.push([t, s / q.length]); } return o; }
    return data;
  };
  // FFT — 창 데이터를 N(2^k) 균일 샘플로 리샘플 후 radix-2 FFT → [주파수Hz, 크기] 배열(양의 주파수).
  const fft = (re, im, N) => {
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) { const a = i + k, b = i + k + len / 2; const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; }
      }
    }
  };
  const fftMag = (data, N = 256) => {
    if (!data || data.length < 8) return null;
    const t0 = data[0][0], t1 = data[data.length - 1][0], span = t1 - t0 || 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    let j = 0;
    for (let k = 0; k < N; k++) { const t = t0 + span * k / (N - 1); while (j < data.length - 2 && data[j + 1][0] < t) j++; const a = data[j], b = data[Math.min(j + 1, data.length - 1)]; const f = (t - a[0]) / ((b[0] - a[0]) || 1); re[k] = a[1] + (b[1] - a[1]) * f; }
    let m = 0;
    for (let k = 0; k < N; k++) m += re[k];
    m /= N;
    for (let k = 0; k < N; k++) re[k] -= m;   // DC 제거
    fft(re, im, N);
    const fs = (N - 1) / span, half = N / 2, out = [];
    for (let k = 1; k < half; k++) out.push([k * fs / N, Math.hypot(re[k], im[k]) * 2 / N]);
    return out;
  };
  const latestT = () => { let m = 0; for (const k in S.series) { const a = S.series[k]; if (a.length) m = Math.max(m, a[a.length - 1][0]); } return m; };

  const list = el('div', { class: 'pl-list' }), grid = el('div', { class: 'pl-grid' }), win = el('span', { class: 'hint' });
  const foll = el('button', { class: 'act', onclick: () => { view.follow = !view.follow; foll.textContent = view.follow ? '▶ follow' : '⏸ frozen'; } }, '▶ follow');
  let layoutW = '100%';
  const setLayout = (w) => { layoutW = w; plots.forEach((p) => { p.cell.style.width = w; p.cell.style.height = '230px'; }); };
  const dl = (name, u) => { const a = el('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); };
  const exportCSV = () => {
    const rows = ['plot,curve,transform,t,value'];
    plots.forEach((p, pi) => p.curves.forEach((c) => { if (c.custom) return; const data = applyT(S.series[c.key], c.tf); if (!data) return; for (const [t, v] of data) rows.push(`${pi},${c.topic}/${c.field},${c.tf},${(+t).toFixed(4)},${v}`); }));
    if (rows.length <= 1) { toast('내보낼 데이터가 없습니다', 'warn'); return; }
    dl('rdash_plots.csv', 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n')));
    toast(`CSV 내보냄 (${rows.length - 1}행)`, 'ok');
  };
  const bar = el('div', { class: 'pl-bar' },
    el('button', { class: 'act', onclick: () => addPlot() }, '+ 플롯'),
    el('button', { class: 'act', onclick: () => setLayout('100%') }, '≡ 세로'),
    el('button', { class: 'act', onclick: () => setLayout('calc(50% - 5px)') }, '⊞ 격자'),
    el('button', { class: 'act', onclick: () => setLayout('calc(33.33% - 6px)') }, '⊟ 3열'),
    el('span', { class: 'hint' }, '창'), ...[5, 10, 30].map((w) => el('button', { class: 'act', onclick: () => { view.W = w; } }, w + 's')),
    el('button', { class: 'act', title: '모든 플롯 데이터를 CSV 로', onclick: exportCSV }, '⭳ CSV'),
    foll, win);
  const pb = { playing: false, speed: 1, last: 0 };
  const scrub = el('input', { type: 'range', min: '0', max: '100', value: '0', step: '0.01', class: 'pl-scrub' });
  const playBtn = el('button', { class: 'act', onclick: () => { pb.playing = !pb.playing; pb.last = 0; playBtn.textContent = pb.playing ? '⏸' : '▶'; view.follow = false; foll.textContent = '⏸ frozen'; } }, '▶');
  const spdSel = el('select', {});
  [0.25, 0.5, 1, 2, 4].forEach((s) => spdSel.append(el('option', { value: s }, s + '×')));
  spdSel.value = '1';
  spdSel.onchange = () => { pb.speed = +spdSel.value; };
  const scrubLbl = el('span', { class: 'hint' });
  scrub.oninput = () => { view.follow = false; foll.textContent = '⏸ frozen'; view.tEnd = +scrub.value; };
  const scrubBar = el('div', { class: 'pl-scrubbar' }, playBtn, spdSel, scrub, scrubLbl);
  const bagInp = el('input', { placeholder: 'bag 경로(디렉터리)', style: 'width:140px' });
  const bagBtn = el('button', { class: 'act' }, '🗀 bag');
  bagBtn.onclick = async () => {
    const pth = bagInp.value.trim();
    if (!pth) return;
    bagBtn.textContent = '로딩…';
    let r;
    try { r = await api('/api/bagdump?path=' + encodeURIComponent(pth) + '&topics='); } catch (_) { r = {}; }
    bagBtn.textContent = '🗀 bag';
    if (r && r.series && Object.keys(r.series).length) {
      for (const key in r.series) {
        S.series[key] = r.series[key];
        const sp = key.indexOf(' '), tp = key.slice(0, sp), fld = key.slice(sp + 1);
        S.bag.add(tp);
        if (S.es[tp]) { S.es[tp].close(); delete S.es[tp]; }
        S.fields[tp] = S.fields[tp] || [];
        if (!S.fields[tp].includes(fld)) S.fields[tp].push(fld);
      }
      view.follow = false;
      foll.textContent = '⏸ frozen';
      view.W = Math.max(5, r.t1 || 10);
      view.tEnd = r.t1 || 0;
      drawList();
      win.textContent = ` 📁 bag: ${Object.keys(r.series).length} 커브 · ${(r.t1 || 0).toFixed(1)}s`;
    } else win.textContent = ' bag 로드 실패(경로/rosbag2 확인)';
  };
  bar.append(bagInp, bagBtn);
  openModal('📈 PlotLab — 다중 동기 플롯 (PlotJuggler 스타일)', el('div', { class: 'pl' }, bar, el('div', { class: 'pl-body' }, list, grid), scrubBar));
  const M = document.querySelector('#modal .m');
  const savedW = M ? M.style.cssText : '';
  if (M) { M.style.width = 'min(1500px,97vw)'; M.style.height = '90vh'; M.style.maxHeight = '90vh'; }

  const search = el('input', { placeholder: '토픽/필드 검색…', style: 'width:100%;margin-bottom:6px' }), listBody = el('div', {});
  list.append(el('div', { class: 'hint', style: 'margin-bottom:4px' }, '커브 (드래그 → 플롯)'), search, listBody);
  const drawList = () => {
    const f = search.value.toLowerCase();
    listBody.innerHTML = '';
    const tset = new Set(state.items.filter((i) => i.kind === 'topic' && !i.name.includes('/_action/')).map((i) => i.name));
    Object.keys(S.fields).forEach((t) => tset.add(t));
    for (const tp of [...tset].sort()) {
      const flds = S.fields[tp] || [];
      if (f && !tp.toLowerCase().includes(f) && !flds.some((x) => (tp + ' ' + x).toLowerCase().includes(f))) continue;
      const head = el('div', { class: 'pl-topic' }, (flds.length ? '▾ ' : '▸ ') + tp);
      head.onclick = () => { sub(tp); setTimeout(drawList, 350); };
      listBody.append(head);
      for (const fld of flds) {
        if (f && !(tp + ' ' + fld).toLowerCase().includes(f)) continue;
        const key = tp + ' ' + fld;
        const chip = el('div', { class: 'pl-chip', draggable: 'true', title: '드래그 또는 클릭 → 마지막 플롯' }, fld);
        chip.ondragstart = (e) => e.dataTransfer.setData('text/plain', key);
        chip.onclick = () => { if (plots.length) addCurve(plots[plots.length - 1], key); };
        listBody.append(chip);
      }
    }
  };
  search.oninput = drawList;
  drawList();
  const listIv = setInterval(() => { if (!$('#modal').classList.contains('on')) { clearInterval(listIv); return; } drawList(); }, 1500);

  function addCurve(plot, key) {
    if (!key || plot.curves.some((c) => c.key === key)) return;
    const sp = key.indexOf(' '), topic = key.slice(0, sp);
    sub(topic);
    plot.curves.push({ key, topic, field: key.slice(sp + 1), color: PAL[colorI++ % PAL.length], tf: 'raw' });
    plot.drawLegend();
  }
  // 새창(pop-out) — 이 플롯의 커브 설정을 popup.html 에 넘겨 독립 창에서 렌더(같은 SSE 재사용).
  function popOut(plot) {
    const curves = plot.curves.filter((c) => !c.custom).map((c) => ({ topic: c.topic, field: c.field, tf: c.tf, color: c.color }));
    if (!curves.length) { toast('커브를 먼저 추가하세요', 'warn'); return; }
    const cfg = encodeURIComponent(JSON.stringify({ curves, xy: !!plot.xy, fft: !!plot.fft, W: view.W }));
    window.open('/popup.html#' + cfg, '_blank', 'width=780,height=470');
  }
  function addPlot() {
    const canvas = el('canvas', { class: 'pl-canvas' }), legend = el('div', { class: 'pl-legend' }), cell = el('div', { class: 'pl-cell' });
    const plot = { curves: [], canvas, legend, cell };
    const drawLegend = () => {
      legend.innerHTML = '';
      const xyBtn = el('span', { class: 'pl-btn2' + (plot.xy ? ' on' : ''), title: 'XY 플롯(c0=X)', onclick: () => { plot.xy = !plot.xy; if (plot.xy) plot.fft = false; drawLegend(); } }, 'XY');
      const fftBtn = el('span', { class: 'pl-btn2' + (plot.fft ? ' on' : ''), title: 'FFT 스펙트럼(주파수축)', onclick: () => { plot.fft = !plot.fft; if (plot.fft) plot.xy = false; drawLegend(); } }, 'FFT');
      const fxBtn = el('span', { class: 'pl-btn2', title: '커스텀 수식 커브', onclick: () => { plot._fx = !plot._fx; drawLegend(); } }, 'ƒ');
      legend.append(el('span', { class: 'pl-cv' }, xyBtn, fftBtn, fxBtn));
      if (plot._fx) {
        const inp = el('input', { placeholder: '수식(c0,c1…): c0-c1, Math.hypot(c0,c1)' });
        const add = el('button', { class: 'pl-btn2', onclick: () => { const ex = inp.value.trim(); if (!ex) return; let fn; try { fn = new Function('c', 'Math', 't', 'return (' + ex + ')'); } catch (_) { return; } plot.curves.push({ custom: true, expr: ex, fn, field: 'ƒ ' + ex, topic: '', color: PAL[colorI++ % PAL.length], tf: 'raw' }); plot._fx = false; drawLegend(); } }, '추가');
        legend.append(el('span', { class: 'pl-fx' }, inp, add));
      }
      let si = 0;
      plot.curves.forEach((c) => {
        const idx = c.custom ? null : 'c' + (si++);
        const name = c.custom ? c.field : (idx + ': ' + c.topic.replace(/^\//, '') + '/' + c.field);
        const kids = [el('span', { class: 'pl-dot', style: 'background:' + c.color }), name];
        if (!c.custom) {
          const selT = el('select', {});
          for (const t in TF) selT.append(el('option', { value: t }, TF[t]));
          selT.value = c.tf;
          selT.onchange = () => { c.tf = selT.value; };
          kids.push(selT);
        }
        c._st = el('span', { class: 'pl-stat' });
        kids.push(c._st, el('span', { class: 'pl-rm', onclick: () => { plot.curves = plot.curves.filter((z) => z !== c); drawLegend(); } }, '×'));
        legend.append(el('span', { class: 'pl-cv' }, ...kids));
      });
    };
    plot.drawLegend = drawLegend;
    cell.ondragover = (e) => { e.preventDefault(); cell.classList.add('drop'); };
    cell.ondragleave = () => cell.classList.remove('drop');
    cell.ondrop = (e) => { e.preventDefault(); cell.classList.remove('drop'); addCurve(plot, e.dataTransfer.getData('text/plain')); };
    cell.style.width = layoutW;
    cell.append(canvas, legend,
      el('button', { class: 'pl-x', style: 'right:46px', title: 'PNG 이미지 저장', onclick: () => { const c = el('canvas', { width: canvas.width, height: canvas.height }); const cx = c.getContext('2d'); cx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg2') || '#0d1116'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(canvas, 0, 0); dl('rdash_plot.png', c.toDataURL('image/png')); toast('PNG 저장됨', 'ok'); } }, '⭳'),
      el('button', { class: 'pl-x', style: 'right:26px', title: '새창에서 보기', onclick: () => popOut(plot) }, '⧉'),
      el('button', { class: 'pl-x', onclick: () => { const i = plots.indexOf(plot); if (i >= 0) plots.splice(i, 1); cell.remove(); } }, '✕'));
    plots.push(plot);
    grid.append(cell);
  }
  addPlot();

  // 소스 데이터에서 시각 t 에서의 최근값(≤t) — 커스텀 수식 리샘플링용.
  const sampleAt = (data, t) => { if (!data || !data.length) return 0; let lo = 0, hi = data.length - 1, r = data[0][1]; while (lo <= hi) { const m = (lo + hi) >> 1; if (data[m][0] <= t) { r = data[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
  const evalCustom = (c, srcs, t0, t1) => {
    if (!srcs.length || !c.fn) return [];
    const base = applyT(S.series[srcs[0].key], srcs[0].tf).filter(([t]) => t >= t0 && t <= t1);
    const others = srcs.map((s) => applyT(S.series[s.key], s.tf));
    const o = [];
    for (const [t] of base) { let v; try { v = c.fn(others.map((d) => sampleAt(d, t)), Math, t); } catch (_) { v = NaN; } if (isFinite(v)) o.push([t, v]); }
    return o;
  };
  let raf = 0, alive = true;
  function frame() {
    if (!alive) return;
    const lt = latestT();
    let minT = Infinity, maxT = 0;
    for (const k in S.series) { const a = S.series[k]; if (a.length) { if (a[0][0] < minT) minT = a[0][0]; if (a[a.length - 1][0] > maxT) maxT = a[a.length - 1][0]; } }
    if (!isFinite(minT)) minT = 0;
    const now = Date.now();
    if (pb.playing) { const dt = (now - (pb.last || now)) / 1000 * pb.speed; view.tEnd = Math.min(maxT, view.tEnd + dt); if (view.tEnd >= maxT - 1e-3) { pb.playing = false; playBtn.textContent = '▶'; } }
    pb.last = now;
    if (view.follow) view.tEnd = lt;
    if (document.activeElement !== scrub) { scrub.min = minT; scrub.max = maxT || 1; scrub.value = view.tEnd; }
    const t1 = view.tEnd, t0 = t1 - view.W;
    win.textContent = ` t=${t1.toFixed(1)}s · 창 ${view.W.toFixed(0)}s`;
    scrubLbl.textContent = ` ${(t1 - minT).toFixed(1)}/${(maxT - minT).toFixed(1)}s`;
    for (const pl of plots) {
      const cv = pl.canvas, W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight || 150, ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = '#1b222c';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = H * i / 4; ctx.beginPath(); ctx.moveTo(32, y); ctx.lineTo(W, y); ctx.stroke(); }
      const srcs = pl.curves.filter((c) => !c.custom);
      const cd = pl.curves.map((c) => ({ c, d: c.custom ? evalCustom(c, srcs, t0, t1) : applyT(S.series[c.key], c.tf).filter(([t]) => t >= t0 && t <= t1) }));
      if (pl.fft) {   // ── FFT 스펙트럼: X=주파수(Hz), Y=크기 ──
        const spectra = cd.map((z) => ({ c: z.c, m: fftMag(z.d) })).filter((z) => z.m);
        let fmax = 1, amax = 1e-9;
        for (const { m } of spectra) for (const [f, a] of m) { if (f > fmax) fmax = f; if (a > amax) amax = a; }
        const PX = (f) => 32 + f / fmax * (W - 40), PY = (a) => H - 12 - a / amax * (H - 20);
        ctx.strokeStyle = '#1b222c';
        for (let i = 0; i <= 4; i++) { const x = 32 + (W - 40) * i / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 12); ctx.stroke(); }
        ctx.fillStyle = '#5c6672';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('0Hz', 32, H - 2);
        ctx.textAlign = 'right';
        ctx.fillText(fmax.toFixed(0) + 'Hz', W - 4, H - 2);
        ctx.textAlign = 'left';
        ctx.fillText('|X|', 2, 9);
        for (const { c, m } of spectra) {
          ctx.strokeStyle = c.color;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          m.forEach(([f, a], i) => { const x = PX(f), y = PY(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          ctx.stroke();
          if (c._st) { let pk = 0, pf = 0; for (const [f, a] of m) if (a > pk) { pk = a; pf = f; } c._st.textContent = ` peak ${pf.toFixed(1)}Hz`; }
        }
        continue;
      }
      if (pl.xy && srcs.length >= 2) {   // ── XY 플롯: c0=X, 나머지=Y ──
        const xd = cd.find((z) => z.c === srcs[0]).d;
        let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
        for (const [, v] of xd) { if (v < xmn) xmn = v; if (v > xmx) xmx = v; }
        const yset = cd.filter((z) => z.c !== srcs[0]);
        for (const { d } of yset) for (const [, v] of d) { if (v < ymn) ymn = v; if (v > ymx) ymx = v; }
        if (!isFinite(xmn)) { xmn = 0; xmx = 1; }
        if (xmx - xmn < 1e-9) { xmx += 1; xmn -= 1; }
        if (!isFinite(ymn)) { ymn = 0; ymx = 1; }
        if (ymx - ymn < 1e-9) { ymx += 1; ymn -= 1; }
        const PX = (v) => 32 + (v - xmn) / (xmx - xmn) * (W - 40), PY = (v) => H - 6 - (v - ymn) / (ymx - ymn) * (H - 20);
        ctx.fillStyle = '#5c6672';
        ctx.font = '9px monospace';
        ctx.fillText('X:' + srcs[0].field, 34, H - 3);
        ctx.fillText(ymx.toPrecision(3), 2, 9);
        for (const { c, d } of yset) {
          ctx.strokeStyle = c.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          d.forEach(([t, vy], i) => { const vx = sampleAt(applyT(S.series[srcs[0].key], srcs[0].tf), t); const x = PX(vx), y = PY(vy); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          ctx.stroke();
        }
        continue;
      }
      let mn = Infinity, mx = -Infinity;
      for (const { d } of cd) for (const [, v] of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
      const X = (t) => 32 + (t - t0) / (view.W || 1) * (W - 36), Y = (v) => H - 4 - (v - mn) / (mx - mn) * (H - 18);
      ctx.fillStyle = '#5c6672';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(mx.toPrecision(3), 2, 9);
      ctx.fillText(mn.toPrecision(3), 2, H - 4);
      for (const { c, d } of cd) {
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        d.forEach(([t, v], i) => { const x = X(t), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
        if (c._st && d.length) { let s = 0, lo = Infinity, hi = -Infinity; for (const [, v] of d) { s += v; if (v < lo) lo = v; if (v > hi) hi = v; } c._st.textContent = ` [${d[d.length - 1][1].toPrecision(3)}] μ${(s / d.length).toPrecision(3)} ↕${lo.toPrecision(2)}~${hi.toPrecision(2)}`; }
      }
      if (cursorT != null && cursorT >= t0 && cursorT <= t1) { const cx = X(cursorT); ctx.strokeStyle = '#8b97a7'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke(); ctx.setLineDash([]); }
    }
    raf = requestAnimationFrame(frame);
    if (SNAP && ++frame.n > 900) alive = false;
  }
  frame.n = 0;
  frame();

  grid.addEventListener('wheel', (e) => { e.preventDefault(); view.W = Math.max(1, Math.min(300, view.W * (e.deltaY < 0 ? 0.85 : 1.18))); }, { passive: false });
  let pan = null;
  grid.addEventListener('mousedown', (e) => { pan = { x: e.clientX, tEnd: view.tEnd }; view.follow = false; foll.textContent = '⏸ frozen'; });
  window.addEventListener('mouseup', () => { pan = null; });
  grid.addEventListener('mousemove', (e) => {
    const cell = e.target.closest && e.target.closest('.pl-cell');
    if (cell) { const r = cell.querySelector('canvas').getBoundingClientRect(); const frac = (e.clientX - r.left - 32) / (r.width - 36); cursorT = view.tEnd - view.W + frac * view.W; }
    if (pan) { const r = grid.getBoundingClientRect(); view.tEnd = pan.tEnd - (e.clientX - pan.x) / r.width * view.W; }
  });

  setModalSub({ close: () => { alive = false; cancelAnimationFrame(raf); clearInterval(listIv); for (const t in S.es) S.es[t].close(); if (M) M.style.cssText = savedW; } });
}
