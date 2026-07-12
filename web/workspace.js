/* RDash 워크스페이스 — 도킹형 타일 패널 레이아웃(모자이크). 패널을 분할/추가/닫기,
   구분선 드래그로 크기 조절, 레이아웃 localStorage 저장. app.js 전역(el/items/numeric/
   mkScene/buildGraph/emptyState/spinner) 재사용. 독자 구현(외부 코드 미사용). */
'use strict';
(function () {
  const PAL = ['#57c7d4', '#e2c85a', '#6fd08c', '#c78ad2', '#e06a6a', '#6f9be0', '#d98a4b', '#7ad2b8'];
  const LS = 'rdash-ws-layout';
  let uid = 1; const nid = () => 'p' + (uid++);

  // ── 패널 레지스트리 ──
  const PANELS = {
    graph: { name: '토픽 그래프', icon: '🕸', make: makeGraph },
    plot: { name: '플롯', icon: '📈', make: makePlot },
    raw: { name: 'Raw 메시지', icon: '🧾', make: makeRaw },
    image: { name: '이미지', icon: '🖼', make: makeImage },
    scene3d: { name: '3D 씬', icon: '🧊', make: makeScene },
    diag: { name: '진단', icon: '🩺', make: makeStream, arg: { ep: '/diagnostics', kind: 'diag' } },
    log: { name: '로그', icon: '📜', make: makeStream, arg: { ep: '/rosout', kind: 'log' } },
  };

  // ── 레이아웃 상태 ──
  let tree = null, focusId = null, live = new Map(); // id → {dispose}
  function defaultTree() { return { split: 'row', ratio: 0.6, a: leaf('graph'), b: { split: 'col', ratio: 0.5, a: leaf('plot'), b: leaf('raw') } }; }
  function leaf(panel, cfg) { return { id: nid(), panel, cfg: cfg || {} }; }

  function save() { try { localStorage.setItem(LS, JSON.stringify({ tree: strip(tree) })); } catch (_) { /* */ } }
  function strip(n) { return n.split ? { split: n.split, ratio: n.ratio, a: strip(n.a), b: strip(n.b) } : { leaf: 1, id: n.id, panel: n.panel, cfg: n.cfg }; }
  function hydrate(n) { if (!n) return null; if (n.split) return { split: n.split, ratio: n.ratio, a: hydrate(n.a), b: hydrate(n.b) }; const id = n.id || nid(); return { id, panel: n.panel, cfg: n.cfg || {} }; }
  function load() { try { const o = JSON.parse(localStorage.getItem(LS)); if (o && o.tree) return hydrate(o.tree); } catch (_) { /* */ } return defaultTree(); }

  // ── 트리 연산 ──
  function findParent(node, id, parent) { if (!node) return null; if (node.id === id) return parent; if (node.split) return findParent(node.a, id, node) || findParent(node.b, id, node); return null; }
  function firstLeaf(node) { return node.split ? firstLeaf(node.a) : node; }
  function splitLeaf(id, dir) { const p = findParent(tree, id, null); const target = leafById(tree, id); if (!target) return;
    const repl = { split: dir, ratio: 0.5, a: target, b: leaf(target.panel, JSON.parse(JSON.stringify(target.cfg))) };
    if (!p) tree = repl; else if (p.a === target) p.a = repl; else p.b = repl; focusId = repl.b.id; render(); }
  function leafById(node, id) { if (!node) return null; if (node.id === id) return node; if (node.split) return leafById(node.a, id) || leafById(node.b, id); return null; }
  function removeLeaf(id) { const p = findParent(tree, id, null); if (!p) { tree = leaf('graph'); focusId = tree.id; render(); return; } // 루트면 리셋
    const sib = p.a.id === id ? p.b : (p.b.id === id ? p.a : (leafById(p.a, id) ? p.b : p.a));
    const gp = findParent(tree, p.id, null) || parentOfSplit(tree, p, null);
    if (!gp) tree = sib; else if (gp.a === p) gp.a = sib; else gp.b = sib; render(); }
  function parentOfSplit(node, target, parent) { if (!node || !node.split) return null; if (node === target) return parent; return parentOfSplit(node.a, target, node) || parentOfSplit(node.b, target, node); }
  function setType(id, type) { const l = leafById(tree, id); if (!l) return; l.panel = type; l.cfg = {}; render(); }
  function addPanel(type) { const t = focusId ? leafById(tree, focusId) : firstLeaf(tree); if (!t) { tree = leaf(type); focusId = tree.id; render(); return; } splitLeafInto(t.id, 'row', type); }
  function splitLeafInto(id, dir, type) { const p = findParent(tree, id, null); const target = leafById(tree, id); const nl = leaf(type);
    const repl = { split: dir, ratio: 0.5, a: target, b: nl }; if (!p) tree = repl; else if (p.a === target) p.a = repl; else p.b = repl; focusId = nl.id; render(); }

  // ── 렌더 ──
  let root = null;
  function render() {
    for (const [, inst] of live) { try { inst.dispose && inst.dispose(); } catch (_) { /* */ } } live.clear();
    root.innerHTML = ''; renderNode(tree, root); save();
  }
  function renderNode(node, container) {
    if (node.split) {
      const box = el('div', { class: 'wssplit ' + node.split }); container.append(box);
      const pa = el('div', { class: 'wspane' }), pb = el('div', { class: 'wspane' });
      pa.style.flex = node.ratio + ' 1 0'; pb.style.flex = (1 - node.ratio) + ' 1 0';
      const divi = el('div', { class: 'wsdiv ' + node.split });
      box.append(pa, divi, pb); renderNode(node.a, pa); renderNode(node.b, pb);
      dividerDrag(divi, node, box, pa, pb);
    } else { renderLeaf(node, container); }
  }
  function dividerDrag(divi, node, box, pa, pb) {
    divi.onmousedown = (e) => { e.preventDefault(); const horiz = node.split === 'row';
      const move = (ev) => { const r = box.getBoundingClientRect(); let ratio = horiz ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        ratio = Math.max(0.12, Math.min(0.88, ratio)); node.ratio = ratio; pa.style.flex = ratio + ' 1 0'; pb.style.flex = (1 - ratio) + ' 1 0'; };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); save(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); };
  }
  function renderLeaf(node, container) {
    const P = PANELS[node.panel] || PANELS.raw;
    const wrap = el('div', { class: 'wsleaf' + (focusId === node.id ? ' focus' : '') });
    // 헤더: 타입 선택 · 설정 슬롯 · 분할/닫기
    const typeSel = el('select', { class: 'wssel wstype' });
    for (const k in PANELS) typeSel.append(el('option', { value: k }, PANELS[k].icon + ' ' + PANELS[k].name));
    typeSel.value = node.panel; typeSel.onchange = () => setType(node.id, typeSel.value);
    const cfgSlot = el('div', { class: 'wscfg' });
    const btn = (t, title, fn) => el('button', { class: 'wsib', title, onclick: (e) => { e.stopPropagation(); fn(); } }, t);
    const head = el('div', { class: 'wshead' }, typeSel, cfgSlot, el('div', { style: 'flex:1' }),
      btn('⇥', '오른쪽으로 분할', () => splitLeaf(node.id, 'row')),
      btn('⤓', '아래로 분할', () => splitLeaf(node.id, 'col')),
      btn('✕', '패널 닫기', () => removeLeaf(node.id)));
    const body = el('div', { class: 'wsbody' });
    wrap.append(head, body); container.append(wrap);
    wrap.onmousedown = () => { if (focusId !== node.id) { focusId = node.id; document.querySelectorAll('.wsleaf').forEach((x) => x.classList.remove('focus')); wrap.classList.add('focus'); } };
    const ctx = { cfgSlot, save };
    let inst = {}; try { inst = P.make(body, node.cfg, ctx, P.arg) || {}; } catch (err) { body.append(emptyState('⚠', '패널 오류', String(err && err.message || err))); }
    live.set(node.id, inst);
  }

  // ── 공통: 토픽 셀렉트 ──
  function topicSelect(ctx, cfg, filter, label, key, onChange) {
    const s = el('select', { class: 'wssel' }); s.append(el('option', { value: '' }, '(' + label + ')'));
    items.filter((i) => i.kind === 'topic' && !(i.name || '').includes('/_action/') && filter(i)).forEach((i) => s.append(el('option', { value: i.name }, i.name)));
    if (cfg[key]) s.value = cfg[key];
    s.onchange = () => { cfg[key] = s.value; ctx.save(); onChange(s.value); };
    ctx.cfgSlot.append(s); return s;
  }
  const isImg = (i) => /CompressedImage|sensor_msgs\/(msg\/)?Image/.test(i.ty || '');
  const isCloud = (i) => (i.ty || '').includes('PointCloud2');
  const isMarker = (i) => /visualization_msgs\/(msg\/)?Marker(Array)?/.test(i.ty || '');
  const isAnn = (i) => /Detection2D(Array)?|ImageAnnotations/.test(i.ty || '');
  const isCamInfo = (i) => /CameraInfo/.test(i.ty || '');

  // ── 패널: Raw 메시지 ──
  function makeRaw(host, cfg, ctx) {
    const pre = el('pre', { class: 'wsraw' }); host.append(pre); let es = null;
    const sub = (t) => { if (es) { es.close(); es = null; } pre.textContent = ''; if (!t) { pre.append(emptyState('🧾', '토픽 선택', '헤더에서 토픽을 고르세요')); return; }
      es = new EventSource('/echo?topic=' + encodeURIComponent(t)); es.onmessage = (e) => { try { pre.textContent = JSON.parse(e.data); } catch (_) { /* */ } }; };
    topicSelect(ctx, cfg, () => true, '토픽', 'topic', sub); sub(cfg.topic);
    return { dispose() { if (es) es.close(); } };
  }

  // ── 패널: 플롯 ──
  function makePlot(host, cfg, ctx) {
    cfg.fields = cfg.fields || {};
    const cv = el('canvas', { class: 'wscanvas' }); const legend = el('div', { class: 'wslegend' });
    host.append(cv, legend); const series = {}, order = []; let t0 = Date.now(), es = null, raf = 0, alive = true;
    const sub = (t) => { if (es) { es.close(); es = null; } for (const k in series) delete series[k]; order.length = 0; legend.innerHTML = ''; if (!t) return;
      es = new EventSource('/echo?topic=' + encodeURIComponent(t));
      es.onmessage = (e) => { let txt; try { txt = JSON.parse(e.data); } catch (_) { return; } const nums = numeric(txt); const tt = (Date.now() - t0) / 1000;
        for (const [k, v] of Object.entries(nums)) { if (!series[k]) { series[k] = []; order.push(k); if (cfg.fields[k] === undefined && order.length <= 2) cfg.fields[k] = true; drawLegend(); } series[k].push([tt, v]); if (series[k].length > 800) series[k].shift(); } }; };
    const drawLegend = () => { legend.innerHTML = ''; order.forEach((k, i) => { const on = cfg.fields[k] !== false;
      const chip = el('span', { class: 'wscv', style: 'opacity:' + (on ? 1 : .45) }, el('span', { class: 'wsdot', style: 'background:' + (on ? PAL[i % PAL.length] : '#666') }), k.length > 26 ? '…' + k.slice(-24) : k);
      chip.onclick = () => { cfg.fields[k] = !on; ctx.save(); drawLegend(); }; legend.append(chip); }); };
    const draw = () => { const W = cv.width = cv.clientWidth, H = cv.height = cv.clientHeight; const ctx2 = cv.getContext('2d'); ctx2.clearRect(0, 0, W, H);
      const keys = order.filter((k) => cfg.fields[k] !== false && series[k] && series[k].length > 1); if (!keys.length) return;
      let mn = Infinity, mx = -Infinity, t1 = Infinity, t2 = -Infinity; for (const k of keys) for (const [t, v] of series[k]) { if (v < mn) mn = v; if (v > mx) mx = v; if (t < t1) t1 = t; if (t > t2) t2 = t; }
      if (mx - mn < 1e-9) { mx += 1; mn -= 1; } const cs = getComputedStyle(document.documentElement); const grid = cs.getPropertyValue('--line') || '#232b36';
      ctx2.strokeStyle = grid; ctx2.lineWidth = 1; for (let i = 0; i <= 3; i++) { const y = 4 + (H - 8) * i / 3; ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(W, y); ctx2.stroke(); }
      keys.forEach((k) => { const ci = order.indexOf(k); ctx2.strokeStyle = PAL[ci % PAL.length]; ctx2.lineWidth = 1.4; ctx2.beginPath();
        series[k].forEach(([t, v], i) => { const x = (t - t1) / (t2 - t1 || 1) * (W - 6) + 3, y = H - 6 - (v - mn) / (mx - mn) * (H - 14); i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y); }); ctx2.stroke(); }); };
    const frame = () => { if (!alive) return; draw(); raf = requestAnimationFrame(frame); };
    topicSelect(ctx, cfg, () => true, '토픽', 'topic', sub); sub(cfg.topic); frame();
    return { dispose() { alive = false; cancelAnimationFrame(raf); if (es) es.close(); } };
  }

  // ── 패널: 스트림(진단/로그) ──
  function makeStream(host, cfg, ctx, arg) {
    const tbl = el('div', { class: 'wsstream' }); host.append(tbl); const rows = []; const s = new EventSource(arg.ep);
    const push = (a, b, cls) => { rows.push({ a, b, cls }); if (rows.length > 500) rows.shift(); rerender(); };
    const rerender = () => { tbl.innerHTML = ''; rows.slice(-300).forEach((r) => tbl.append(el('div', { class: 'wsline ' + r.cls }, el('b', {}, r.a), ' ', r.b))); tbl.scrollTop = tbl.scrollHeight; };
    s.onmessage = (e) => { let blk; try { blk = JSON.parse(e.data); } catch (_) { return; }
      if (arg.kind === 'log') { const L = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']; const lv = /level:\s*(\d+)/.exec(blk), nm = /name:\s*["']?([^\n"']+)/.exec(blk), ms = /msg:\s*["']?(.*)/.exec(blk); const l = lv ? +lv[1] : 0; const idx = l >= 50 ? 4 : l >= 40 ? 3 : l >= 30 ? 2 : l >= 20 ? 1 : 0; push(L[idx], (nm ? nm[1].trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), idx >= 3 ? 'ERROR' : idx === 2 ? 'WARN' : 'OK'); }
      else { const LV = ['OK', 'WARN', 'ERROR', 'STALE']; const si = blk.indexOf('status:'); const sb = si >= 0 ? blk.slice(si) : blk; for (const part of sb.split(/\n\s*- /).slice(1)) { const lv = /level:\s*(\d+)/.exec(part), nm = /name:\s*["']?(.*)/.exec(part), ms = /message:\s*["']?(.*)/.exec(part); const l = lv ? +lv[1] : 0; push(LV[l] || '?', (nm ? nm[1].replace(/["']\s*$/, '').trim() : '?') + ': ' + (ms ? ms[1].replace(/["']\s*$/, '').trim() : ''), LV[l] || 'OK'); } } };
    return { dispose() { s.close(); } };
  }

  // ── 패널: 이미지(어노테이션/보정 오버레이) ──
  function makeImage(host, cfg, ctx) {
    const img = el('img', { class: 'wsimg' }); const ov = el('canvas', { class: 'wsov' });
    const stage = el('div', { class: 'wsstage' }, img, ov); host.append(stage);
    let ann = { boxes: [], points: [], circles: [], texts: [] }, cam = null, es = null, annES = null, camES = null;
    const drawOv = () => { const cw = img.clientWidth, ch = img.clientHeight; if (!cw || !ch) return; ov.width = cw; ov.height = ch; ov.style.width = cw + 'px'; ov.style.height = ch + 'px';
      const iw = (cam && cam.width) || img.naturalWidth || cw, ih = (cam && cam.height) || img.naturalHeight || ch; const kx = cw / iw, ky = ch / ih; const c = ov.getContext('2d'); c.clearRect(0, 0, cw, ch); c.lineWidth = 2; c.font = '11px monospace'; c.textBaseline = 'bottom';
      for (const b of ann.boxes) { const x = (b.cx - b.w / 2) * kx, y = (b.cy - b.h / 2) * ky, w = b.w * kx, h = b.h * ky; c.strokeStyle = '#6fd08c'; c.strokeRect(x, y, w, h); const tag = (b.label || 'obj') + (b.score ? ' ' + (b.score * 100 | 0) + '%' : ''); c.fillStyle = '#6fd08c'; const tw = c.measureText(tag).width + 5; c.fillRect(x, y - 13, tw, 13); c.fillStyle = '#0d1116'; c.fillText(tag, x + 3, y - 2); }
      for (const p of ann.points) { c.fillStyle = `rgb(${p[2]},${p[3]},${p[4]})`; c.beginPath(); c.arc(p[0] * kx, p[1] * ky, 3, 0, 7); c.fill(); }
      for (const cc of ann.circles) { c.strokeStyle = `rgb(${cc.r},${cc.g},${cc.b})`; c.beginPath(); c.arc(cc.x * kx, cc.y * ky, cc.d / 2 * kx, 0, 7); c.stroke(); }
      c.fillStyle = '#e2c85a'; for (const t of ann.texts) c.fillText(t.t, t.x * kx, t.y * ky);
      if (cam && cam.K && cam.K.length === 9) { const px = cam.K[2] * kx, py = cam.K[5] * ky; c.strokeStyle = '#c78ad2'; c.lineWidth = 1; c.beginPath(); c.moveTo(px - 10, py); c.lineTo(px + 10, py); c.moveTo(px, py - 10); c.lineTo(px, py + 10); c.stroke(); } };
    const subImg = (t) => { if (es) { es.close(); es = null; } img.removeAttribute('src'); if (!t) return; es = new EventSource('/imgstream?topic=' + encodeURIComponent(t)); es.onmessage = (e) => { if (e.data) { img.src = 'data:image/jpeg;base64,' + e.data; drawOv(); } }; };
    const subAnn = (t) => { if (annES) { annES.close(); annES = null; } ann = { boxes: [], points: [], circles: [], texts: [] }; if (!t) { drawOv(); return; } annES = new EventSource('/annstream?topic=' + encodeURIComponent(t)); annES.onmessage = (e) => { try { const o = JSON.parse(e.data); ann = { boxes: o.boxes || [], points: o.points || [], circles: o.circles || [], texts: o.texts || [] }; drawOv(); } catch (_) { /* */ } }; };
    const subCam = (t) => { if (camES) { camES.close(); camES = null; } cam = null; if (!t) { drawOv(); return; } camES = new EventSource('/caminfostream?topic=' + encodeURIComponent(t)); camES.onmessage = (e) => { try { cam = JSON.parse(e.data); drawOv(); } catch (_) { /* */ } }; };
    topicSelect(ctx, cfg, isImg, '이미지', 'topic', subImg);
    topicSelect(ctx, cfg, isAnn, '어노테이션', 'ann', subAnn);
    topicSelect(ctx, cfg, isCamInfo, 'CameraInfo', 'cam', subCam);
    img.onload = drawOv; subImg(cfg.topic); subAnn(cfg.ann); subCam(cfg.cam);
    if (!cfg.topic) host.append(emptyState('🖼', '이미지 토픽 선택', '헤더에서 토픽을 고르세요'));
    return { dispose() { if (es) es.close(); if (annES) annES.close(); if (camES) camES.close(); } };
  }

  // ── 패널: 3D 씬 ──
  function makeScene(host, cfg, ctx) {
    const cv = el('canvas', { class: 'wsgl' }); const labelDiv = el('div', { class: 'wsgllabels' });
    const stage = el('div', { class: 'wsstage', style: 'height:100%' }, cv, labelDiv); host.append(stage);
    const scene = mkScene(cv, labelDiv, { textContent: '' }); let cloudES = null, markerES = null, tfES = null;
    const subCloud = (t) => { if (cloudES) { cloudES.close(); cloudES = null; } scene.setCloud(null); if (!t) return; cloudES = new EventSource('/cloudstream?topic=' + encodeURIComponent(t)); cloudES.onmessage = (e) => { if (!e.data) return; const bin = atob(e.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); scene.setCloud(new Float32Array(u8.buffer)); }; };
    const subMarker = (t) => { if (markerES) { markerES.close(); markerES = null; } scene.setMarkers([]); if (!t) return; markerES = new EventSource('/markerstream?topic=' + encodeURIComponent(t)); markerES.onmessage = (e) => { try { const o = JSON.parse(e.data); scene.setMarkers(o.markers || []); } catch (_) { /* */ } }; };
    const subTF = (on) => { if (tfES) { tfES.close(); tfES = null; } scene.setTF([]); if (!on) return; tfES = new EventSource('/tfstream'); tfES.onmessage = (e) => { try { const o = JSON.parse(e.data); scene.setTF(o.frames || []); } catch (_) { /* */ } }; };
    topicSelect(ctx, cfg, isCloud, '클라우드', 'topic', subCloud);
    topicSelect(ctx, cfg, isMarker, '마커', 'marker', subMarker);
    const tf = el('label', { class: 'wschk' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = cfg.tf !== false; c.onchange = () => { cfg.tf = c.checked; ctx.save(); subTF(c.checked); }; return c; })(), 'TF'); ctx.cfgSlot.append(tf);
    subCloud(cfg.topic); subMarker(cfg.marker); subTF(cfg.tf !== false);
    return { dispose() { if (cloudES) cloudES.close(); if (markerES) markerES.close(); if (tfES) tfES.close(); scene.dispose(); } };
  }

  // ── 패널: 토픽 그래프(경량 포스 레이아웃) ──
  function makeGraph(host, cfg, ctx) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'wsgraph'); host.append(svg);
    const P = new Map(); let alive = true, raf = 0, iterTimer = 0;
    function sim() { const g = buildGraph(); const W = host.clientWidth || 400, H = host.clientHeight || 300; const ids = [...g.ents.keys()];
      for (const id of ids) if (!P.has(id)) P.set(id, { x: W / 2 + (Math.random() - .5) * W * .6, y: H / 2 + (Math.random() - .5) * H * .6 });
      for (const id of [...P.keys()]) if (!g.ents.has(id)) P.delete(id);
      for (let it = 0; it < 90; it++) { for (const a of ids) { const pa = P.get(a); let fx = 0, fy = 0;
          for (const b of ids) { if (a === b) continue; const pb = P.get(b); let dx = pa.x - pb.x, dy = pa.y - pb.y; let d2 = dx * dx + dy * dy || 1; const f = 1400 / d2; fx += dx * f; fy += dy * f; }
          fx += (W / 2 - pa.x) * 0.012; fy += (H / 2 - pa.y) * 0.012; pa.x += Math.max(-6, Math.min(6, fx)); pa.y += Math.max(-6, Math.min(6, fy)); }
        for (const e of g.edges) { const pa = P.get(e.from), pb = P.get(e.to); if (!pa || !pb) continue; const dx = pb.x - pa.x, dy = pb.y - pa.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.02; const ux = dx / d * f, uy = dy / d * f; pa.x += ux; pa.y += uy; pb.x -= ux; pb.y -= uy; } }
      for (const id of ids) { const p = P.get(id); p.x = Math.max(20, Math.min(W - 20, p.x)); p.y = Math.max(16, Math.min(H - 16, p.y)); }
      draw(g, W, H); }
    function draw(g, W, H) { const NS = 'http://www.w3.org/2000/svg'; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = '';
      const cs = getComputedStyle(document.documentElement); const cyan = cs.getPropertyValue('--cyan').trim() || '#57c7d4', mag = cs.getPropertyValue('--mag').trim() || '#c78ad2', blue = cs.getPropertyValue('--blue').trim() || '#6f9be0', fg = cs.getPropertyValue('--fg').trim() || '#d5dae2';
      for (const e of g.edges) { const pa = P.get(e.from), pb = P.get(e.to); if (!pa || !pb) continue; const ln = document.createElementNS(NS, 'line'); ln.setAttribute('x1', pa.x); ln.setAttribute('y1', pa.y); ln.setAttribute('x2', pb.x); ln.setAttribute('y2', pb.y); ln.setAttribute('stroke', e.kind === 'service' ? blue : e.kind === 'action' ? mag : '#5a6675'); ln.setAttribute('stroke-width', '1'); if (e.kind === 'action') ln.setAttribute('stroke-dasharray', '3 3'); svg.append(ln); }
      for (const [id, ent] of g.ents) { const p = P.get(id); if (!p) continue; const isNode = ent.type === 'node';
        const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', isNode ? 5 : 3.5); c.setAttribute('fill', isNode ? cyan : ent.type === 'service' ? blue : ent.type === 'action' ? mag : '#3f5266'); svg.append(c);
        const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', p.x + 7); tx.setAttribute('y', p.y + 3); tx.setAttribute('font-size', '9'); tx.setAttribute('fill', isNode ? fg : '#8b97a7'); tx.textContent = id.replace(/^\//, ''); svg.append(tx); } }
    sim(); iterTimer = setInterval(() => { if (alive) sim(); }, 2500);
    return { dispose() { alive = false; cancelAnimationFrame(raf); clearInterval(iterTimer); } };
  }

  // ── 스타일 주입 ──
  function injectCSS() { if (document.getElementById('ws-style')) return; const s = el('style', { id: 'ws-style' }); s.textContent = `
    #ws { position:fixed; inset:0; z-index:12; background:var(--bg); display:none; flex-direction:column; }
    #ws.on { display:flex; }
    .wsbar { display:flex; align-items:center; gap:8px; padding:5px 10px; background:var(--panel); border-bottom:1px solid var(--line); }
    .wsbar b { color:var(--cyan); } .wsbar .sp { flex:1; }
    .wsbar button { background:var(--btn); color:var(--fg); border:1px solid var(--line); border-radius:4px; padding:3px 9px; cursor:pointer; font:inherit; font-size:12px; }
    .wsbar button:hover { border-color:var(--cyan); color:var(--cyan); }
    .wsroot { flex:1; min-height:0; display:flex; padding:6px; gap:0; }
    .wsroot > .wssplit, .wsroot > .wsleaf, .wsroot > .wspane { flex:1; }
    .wssplit { display:flex; flex:1; min-width:0; min-height:0; } .wssplit.row { flex-direction:row; } .wssplit.col { flex-direction:column; }
    .wspane { display:flex; min-width:0; min-height:0; overflow:hidden; }
    .wsdiv { flex:none; background:transparent; } .wsdiv.row { width:6px; cursor:col-resize; } .wsdiv.col { height:6px; cursor:row-resize; }
    .wsdiv:hover { background:var(--cyan); opacity:.4; }
    .wsleaf { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; margin:2px; background:var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
    .wsleaf.focus { border-color:var(--cyan); }
    .wshead { display:flex; align-items:center; gap:5px; padding:3px 5px; background:var(--bg2); border-bottom:1px solid var(--line); }
    .wscfg { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
    .wssel { background:var(--bg2); color:var(--fg); border:1px solid var(--line); border-radius:4px; font:11px monospace; max-width:150px; padding:1px 3px; }
    .wstype { color:var(--cyan); font-weight:600; }
    .wsib { background:none; border:none; color:var(--dim); cursor:pointer; font-size:12px; padding:1px 4px; border-radius:3px; }
    .wsib:hover { color:var(--cyan); background:var(--hover); }
    .wsbody { flex:1; min-height:0; position:relative; overflow:hidden; }
    .wsraw { margin:0; padding:6px 8px; white-space:pre-wrap; font-size:11px; color:var(--fg); height:100%; overflow:auto; }
    .wscanvas { width:100%; height:calc(100% - 22px); display:block; }
    .wslegend { display:flex; flex-wrap:wrap; gap:4px 10px; padding:2px 6px; height:22px; overflow:hidden; align-items:center; }
    .wscv { display:inline-flex; align-items:center; gap:4px; color:var(--fg); font-size:10px; cursor:pointer; }
    .wsdot { width:9px; height:3px; border-radius:2px; }
    .wsstream { height:100%; overflow:auto; padding:4px 8px; font-size:11px; }
    .wsline { padding:1px 0; border-bottom:1px solid var(--line); color:var(--fg); }
    .wsline b { display:inline-block; min-width:44px; } .wsline.WARN { color:var(--yellow); } .wsline.ERROR { color:var(--red); } .wsline.OK b { color:var(--green); }
    .wsstage { position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg2); }
    .wsimg { max-width:100%; max-height:100%; display:block; } .wsov { position:absolute; left:0; top:0; pointer-events:none; }
    .wsgl { width:100%; height:100%; display:block; background:#0b0e12; } .wsgllabels { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
    .wsgraph { width:100%; height:100%; display:block; }
  `; document.head.append(s); }

  // ── 진입점 ──
  function open() { injectCSS(); if (!root) { const host = el('div', { id: 'ws' });
      const bar = el('div', { class: 'wsbar' }, el('b', {}, '▦ 워크스페이스'),
        mkAddMenu(), el('button', { onclick: reset }, '레이아웃 초기화'), el('div', { class: 'sp' }),
        el('button', { onclick: close }, '✕ 대시보드로'));
      root = el('div', { class: 'wsroot' }); host.append(bar, root); document.body.append(host); }
    tree = load(); focusId = firstLeaf(tree).id; render(); document.getElementById('ws').classList.add('on');
  }
  function close() { const h = document.getElementById('ws'); if (h) h.classList.remove('on'); for (const [, inst] of live) { try { inst.dispose && inst.dispose(); } catch (_) { /* */ } } live.clear(); if (root) root.innerHTML = ''; }
  function reset() { tree = defaultTree(); focusId = firstLeaf(tree).id; render(); }
  function mkAddMenu() { const wrap = el('div', { style: 'position:relative' }); const btn = el('button', {}, '＋ 패널');
    const menu = el('div', { class: 'wsmenu', style: 'display:none;position:absolute;top:26px;left:0;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px;z-index:5;min-width:150px;box-shadow:0 6px 20px rgba(0,0,0,.4)' });
    for (const k in PANELS) { const it = el('div', { style: 'padding:4px 8px;cursor:pointer;border-radius:4px;font-size:12px', onmouseover: (e) => e.target.style.background = 'var(--hover)', onmouseout: (e) => e.target.style.background = '' }, PANELS[k].icon + ' ' + PANELS[k].name); it.onclick = () => { menu.style.display = 'none'; addPanel(k); }; menu.append(it); }
    btn.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; };
    document.addEventListener('click', () => { menu.style.display = 'none'; }); wrap.append(btn, menu); return wrap; }

  window.RDWorkspace = { open, close };
})();
