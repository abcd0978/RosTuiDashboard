/* WebGL 3D 씬 렌더러 — 그리드·좌표축·TF 프레임·Marker(큐브/구/실린더/화살표/라인/텍스트)·포인트클라우드 + 투명도
   점/선/삼각형을 pos(vec3)+col(vec4) 한 셰이더로 그린다. 불투명→선→점→반투명(깊이쓰기 off) 순서로 블렌딩.
   + Views.cloud — RViz 식 Displays 패널(mkScene 사용). */

import { $, el, post, SNAP } from '../lib/dom.js';
import { state } from '../lib/state.js';
import { openModal, setModalSub, toast } from '../lib/modal.js';
import { openStream, decodeCloud } from '../lib/stream.js';
import { Clock } from '../lib/clock.js';

const qrot = (q, v) => {
  const x = q[0], y = q[1], z = q[2], w = q[3], a = v[0], b = v[1], c = v[2];
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
};

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

// 열-우선 4x4 역행렬(gluInvertMatrix) — 화면 클릭 → 월드 광선 언프로젝트(그라운드 픽킹)용.
function inv16(m) {
  const o = new Array(16);
  o[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  o[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  o[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  o[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  o[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  o[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  o[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  o[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  o[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  o[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  o[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  o[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  o[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  o[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  o[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  o[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * o[0] + m[1] * o[4] + m[2] * o[8] + m[3] * o[12];
  if (!det) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) o[i] *= det;
  return o;
}

export function mkScene(cv, labelDiv, info) {
  // preserveDrawingBuffer: 온디맨드 렌더(정지 시 draw 스킵)에서 프레임을 건너뛰어도 캔버스가 지워지지 않도록 유지.
  const gl = cv.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true }) || cv.getContext('experimental-webgl');
  if (!gl) {
    info.textContent = 'WebGL 미지원 브라우저';
    return { setCloud() {}, setMarkers() {}, setCloudById() {}, setMarkersById() {}, setVisible() {}, removeDisplay() {}, setTF() {}, opts() {}, view() {}, setPointSize() {}, setPickHandler() {}, setInspect() {}, setPin() {}, setContextHandler() {}, setCamImage() {}, setCamOpts() {}, clearCamera() {}, setInteractiveMarkers() {}, setImHandler() {}, getStats() { return { fps: 0, points: 0, drawn: 0 }; }, dispose() {} };
  }
  const VS = 'attribute vec3 p; attribute vec4 col; uniform mat4 mvp; uniform float psize; varying vec4 vc; void main(){ gl_Position = mvp*vec4(p,1.0); gl_PointSize = psize; vc = col; }';
  const FS = 'precision mediump float; varying vec4 vc; uniform float round; void main(){ if(round>0.5){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; } gl_FragColor = vc; }';
  // 클라우드 전용 셰이더 — xyz 만 올리고 높이색을 GPU(FS)에서 계산: 점당 JS 색 루프 제거 + 버퍼 절반(3f vs 7f).
  // 거리 LOD(GPU): lodDist 너머는 keep=lodDist/depth 비율만 유지(위치 해시로 안정, 깜빡임 없음) + 생존점을 1/√keep 로
  // 키워 밀도 보존. CPU 재정렬 불필요 → 전량 무복사 업로드. (참고: Gaussian-splat 뷰어의 거리 LOD 기법을 점군에 적용.)
  const VSC = 'attribute vec3 p; attribute float c; uniform mat4 mvp; uniform mat4 world; uniform float psize; uniform float lodDist; varying float vz; varying float vc;'
    + ' void main(){ vec4 wp = world*vec4(p,1.0); vec4 clip = mvp*wp; float depth = clip.w; float ps = psize;'
    + ' if(lodDist>0.0 && depth>lodDist){ float keep=max(lodDist/depth,0.04); float h=fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);'
    + ' if(h>keep){ gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=0.0; return; } ps = psize/sqrt(keep); }'
    + ' gl_Position = clip; gl_PointSize = ps; vz = wp.z; vc = c; }';
  // 색상 모드: 0=높이(z) · 1=intensity(jet) · 2=rgb(패킹 언팩) · 3=단색.
  const FSC = 'precision mediump float; varying float vz; varying float vc; uniform float zmin, zmax, round, colorMode, cmin, cmax;'
    + ' void main(){ if(round>0.5){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; } vec3 col;'
    + ' if(colorMode<0.5){ float h=clamp((vz-zmin)/max(zmax-zmin,1e-4),0.0,1.0); col=vec3(0.2+h*0.7,0.66+h*0.14,0.87-h*0.55); }'
    + ' else if(colorMode<1.5){ float h=clamp((vc-cmin)/max(cmax-cmin,1e-4),0.0,1.0); col=vec3(clamp(1.5-abs(4.0*h-3.0),0.0,1.0),clamp(1.5-abs(4.0*h-2.0),0.0,1.0),clamp(1.5-abs(4.0*h-1.0),0.0,1.0)); }'
    + ' else if(colorMode<2.5){ float b=mod(vc,256.0); float g=mod(floor(vc/256.0),256.0); float r=floor(vc/65536.0); col=vec3(r,g,b)/255.0; }'
    + ' else { col=vec3(0.55,0.7,0.85); } gl_FragColor=vec4(col,1.0); }';
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(o)); return o; };
  const mkProg = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
  const prog = mkProg(VS, FS);
  gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'p'), aC = gl.getAttribLocation(prog, 'col'), uMVP = gl.getUniformLocation(prog, 'mvp'), uPS = gl.getUniformLocation(prog, 'psize'), uRound = gl.getUniformLocation(prog, 'round');
  const cprog = mkProg(VSC, FSC);
  const caP = gl.getAttribLocation(cprog, 'p'), caC = gl.getAttribLocation(cprog, 'c'), cuMVP = gl.getUniformLocation(cprog, 'mvp'), cuWorld = gl.getUniformLocation(cprog, 'world'), cuPS = gl.getUniformLocation(cprog, 'psize'), cuZmin = gl.getUniformLocation(cprog, 'zmin'), cuZmax = gl.getUniformLocation(cprog, 'zmax'), cuLod = gl.getUniformLocation(cprog, 'lodDist'), cuRound = gl.getUniformLocation(cprog, 'round'), cuCM = gl.getUniformLocation(cprog, 'colorMode'), cuCmin = gl.getUniformLocation(cprog, 'cmin'), cuCmax = gl.getUniformLocation(cprog, 'cmax');
  const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const gMat4 = () => {
    const g = computeG();
    if (!g) return IDENT16;
    const q = g.q, x = q[0], y = q[1], z = q[2], w = q[3], xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0, 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0, 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0, g.p[0], g.p[1], g.p[2], 1];
  };
  gl.enableVertexAttribArray(caC);
  // 텍스처 프로그램 — 카메라 이미지 3D 투영(광학 프레임에 FOV 크기 텍스처 쿼드).
  const tprog = mkProg('attribute vec3 p; attribute vec2 uv; uniform mat4 mvp; varying vec2 vuv; void main(){ gl_Position = mvp*vec4(p,1.0); vuv = uv; }',
    'precision mediump float; varying vec2 vuv; uniform sampler2D tex; uniform float alpha; void main(){ gl_FragColor = vec4(texture2D(tex, vuv).rgb, alpha); }');
  const taP = gl.getAttribLocation(tprog, 'p'), taUV = gl.getAttribLocation(tprog, 'uv'), tuMVP = gl.getUniformLocation(tprog, 'mvp'), tuTex = gl.getUniformLocation(tprog, 'tex'), tuAlpha = gl.getUniformLocation(tprog, 'alpha');
  const camTex = gl.createTexture(), camBuf = gl.createBuffer();
  const camState = { on: false, ready: false, W: 640, H: 480, fx: 500, fy: 500, frame: '', dist: 2, alpha: 1 };
  gl.enableVertexAttribArray(aP);
  gl.enableVertexAttribArray(aC);
  gl.clearColor(0.043, 0.055, 0.071, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const bufs = { pts: gl.createBuffer(), line: gl.createBuffer(), tri: gl.createBuffer(), triA: gl.createBuffer() };
  const data = { pts: new Float32Array(0), line: new Float32Array(0), tri: new Float32Array(0), triA: new Float32Array(0) };
  const nV = { pts: 0, line: 0, tri: 0, triA: 0 };
  const upload = (k, arr) => { data[k] = arr; nV[k] = arr.length / 7 | 0; gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW); };
  const cloudBuf = gl.createBuffer();
  let cloudN = 0, zmin = 0, zmax = 1, cmin = 0, cmax = 1;   // 클라우드 xyzc 버퍼 + z/c 범위 유니폼
  const permCache = { n: -1, perm: null };   // 거리 LOD 순열 캐시(점수 바뀔 때만 재계산)
  let yaw = 0.7, pitch = -0.6, dist = 12, center = [0, 0, 0.5], psize = 2.4, pan = [0, 0], raf = 0, alive = true;
  // 최적화 옵션(선택 가능) — lodMode: off|distance|adaptive · lodDist: 거리 임계(월드) · targetFps: 적응형 목표 ·
  // maxPoints: 하드 상한(0=무제한) · round: 둥근 점(off=사각, 소프트웨어에서 더 빠름).
  const opt = { axes: true, lodMode: 'adaptive', lodDist: 60, targetFps: 40, maxPoints: 0, round: true, colorMode: 0, follow: null, ortho: false, fixedFrame: null };
  let frames = [], labels = [], frameMap = {};   // frameMap: frame_id → 루트 기준 {p,q}
  // 고정 프레임 변환 g(루트→고정): 고정 프레임의 역변환. null=identity.
  const computeG = () => { const F = opt.fixedFrame && frameMap[opt.fixedFrame]; if (!F) return null; const cq = [-F.q[0], -F.q[1], -F.q[2], F.q[3]]; const pg = qrot(cq, F.p); return { q: cq, p: [-pg[0], -pg[1], -pg[2]] }; };
  const applyG = (g, r) => { if (!g) return r; const v = qrot(g.q, r); return [v[0] + g.p[0], v[1] + g.p[1], v[2] + g.p[2]]; };
  const labelPool = [];          // 라벨 span 재사용(프레임마다 DOM 재생성 방지)
  const clouds = new Map();      // 디스플레이 id → {data:Float32Array(xyz), visible} — 여러 클라우드 동시 렌더
  const markerSets = new Map();  // 디스플레이 id → {markers:[], visible}
  const ims = new Map();         // 인터랙티브 마커 name → {frame_id, pose, scale, visual[], handles[], visible}
  let imDrag = null, imHandler = null, imFeedT = 0;   // 6-DOF 드래그 상태 · 피드백 콜백 · 스로틀
  let fps = 0, lastDrawn = 0, frameN = 0, fpsClock = (typeof performance !== 'undefined' ? performance.now() : 0);
  // 온디맨드 렌더 — 씬이 정지 상태(클라우드 스트리밍/드래그/추종 없음)면 draw 를 건너뛴다(브라우저 GPU 절약).
  let dirty = true;
  let worldF = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const invalidate = () => { dirty = true; };
  const gcd = (a, b) => { while (b) { const t = b; b = a % b; a = t; } return a; };
  // prefix 가 공간적으로 대표성 있도록 큰 서로소 곱 순열(거리 LOD 로 앞쪽 N개만 그려도 골고루).
  const stridePermute = (n) => { const idx = new Uint32Array(n); if (!n) return idx; let step = (Math.floor(n * 0.6180339887) | 1); while (gcd(step, n) !== 1) step++; for (let k = 0, j = 0; k < n; k++, j = (j + step) % n) idx[k] = j; return idx; };
  const perspective = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; };
  const mul = (a, b) => { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const orthoM = (r, t, n, f) => { const nf = 1 / (n - f); return [1 / r, 0, 0, 0, 0, 1 / t, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (f + n) * nf, 1]; };
  function mvpMat() {
    const asp = (cv.clientWidth || 900) / (cv.clientHeight || 520);
    const P = opt.ortho ? orthoM(dist * asp * 0.5, dist * 0.5, 0.05, 5000) : perspective(45 * Math.PI / 180, asp, 0.05, 5000);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Ry = [cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], Rp = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -center[0] + pan[0], -center[1], -center[2] + pan[1], 1], V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1];
    return mul(P, mul(V, mul(Rp, mul(Ry, T))));
  }
  // 화면 클릭 → 그라운드(z=0) 평면 교점(월드). 3D 툴(Publish/Nav Goal/측정)용.
  function pickGround(cx, cy) {
    const rect = cv.getBoundingClientRect(), W = cv.clientWidth, H = cv.clientHeight;
    const nx = (cx - rect.left) / W * 2 - 1, ny = -((cy - rect.top) / H * 2 - 1), inv = inv16(mvpMat());
    if (!inv) return null;
    const un = (z) => { const w = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15]; return [(inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12]) / w, (inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13]) / w, (inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14]) / w]; };
    const a = un(-1), b = un(1);
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-9) return null;
    const t = -a[2] / dz;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
  }
  // ── 지오메트리 빌더(로컬 좌표 → pose(q,p) 적용, 스케일은 생성 시 반영) ──
  const xf = (po, v) => { const r = qrot(po.q, v); return [r[0] + po.p[0], r[1] + po.p[1], r[2] + po.p[2]]; };
  const put = (A, p, c) => { A.push(p[0], p[1], p[2], c[0], c[1], c[2], c[3]); };
  const tri = (A, po, a, b, c, col) => { put(A, xf(po, a), col); put(A, xf(po, b), col); put(A, xf(po, c), col); };
  const line = (A, po, a, b, col) => { put(A, xf(po, a), col); put(A, xf(po, b), col); };
  const BOXV = [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]];
  const BOXF = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [0, 3, 5], [0, 5, 4], [1, 7, 6], [1, 6, 2], [3, 2, 6], [3, 6, 5], [0, 4, 7], [0, 7, 1]];
  function box(A, po, s, col) {
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    for (const f of BOXF) tri(A, po, [BOXV[f[0]][0] * h[0], BOXV[f[0]][1] * h[1], BOXV[f[0]][2] * h[2]], [BOXV[f[1]][0] * h[0], BOXV[f[1]][1] * h[1], BOXV[f[1]][2] * h[2]], [BOXV[f[2]][0] * h[0], BOXV[f[2]][1] * h[1], BOXV[f[2]][2] * h[2]], col);
  }
  function sphere(A, po, s, col, seg) {
    seg = seg || 10;
    const rx = s[0] / 2, ry = s[1] / 2, rz = s[2] / 2;
    const P = (u, v) => [rx * Math.sin(v) * Math.cos(u), ry * Math.sin(v) * Math.sin(u), rz * Math.cos(v)];
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) { const u0 = i / seg * 2 * Math.PI, u1 = (i + 1) / seg * 2 * Math.PI, v0 = j / seg * Math.PI, v1 = (j + 1) / seg * Math.PI; tri(A, po, P(u0, v0), P(u1, v0), P(u1, v1), col); tri(A, po, P(u0, v0), P(u1, v1), P(u0, v1), col); }
  }
  function cyl(A, po, s, col, seg) {
    seg = seg || 16;
    const rx = s[0] / 2, ry = s[1] / 2, hz = s[2] / 2;
    const C = (a, z) => [rx * Math.cos(a), ry * Math.sin(a), z];
    for (let i = 0; i < seg; i++) { const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI; tri(A, po, C(a0, -hz), C(a1, -hz), C(a1, hz), col); tri(A, po, C(a0, -hz), C(a1, hz), C(a0, hz), col); tri(A, po, [0, 0, hz], C(a0, hz), C(a1, hz), col); tri(A, po, [0, 0, -hz], C(a1, -hz), C(a0, -hz), col); }
  }
  function arrow(A, po, s, col, seg) {
    seg = seg || 12;
    const L = s[0] || 1, rs = (s[1] || 0.1) / 2, rh = (s[2] || 0.2) / 2, sl = L * 0.72;
    const C = (a, x, r) => [x, r * Math.cos(a), r * Math.sin(a)];
    for (let i = 0; i < seg; i++) { const a0 = i / seg * 2 * Math.PI, a1 = (i + 1) / seg * 2 * Math.PI; tri(A, po, C(a0, 0, rs), C(a1, 0, rs), C(a1, sl, rs), col); tri(A, po, C(a0, 0, rs), C(a1, sl, rs), C(a0, sl, rs), col); tri(A, po, [L, 0, 0], C(a0, sl, rh), C(a1, sl, rh), col); }
  }
  // 마커 1개 → 지오메트리 버퍼(L=선, T=불투명 삼각형, TA=반투명, Pc=점, labels=텍스트). 마커셋·인터랙티브 마커 공용.
  function emitMarker(m, po, L, T, TA, Pc, labels) {
    const col = m.color && m.color.length === 4 ? m.color : [0.6, 0.8, 0.9, 1];
    const A = col[3] < 0.99 ? TA : T, s = m.scale || [1, 1, 1], pts = m.points || [], cols = m.colors || [];
    if (m.type === 1) box(A, po, s, col);
    else if (m.type === 2) sphere(A, po, s, col);
    else if (m.type === 3) cyl(A, po, s, col);
    else if (m.type === 0) arrow(A, po, s, col);
    else if (m.type === 6) pts.forEach((q, i) => box(A, { q: po.q, p: xf(po, q) }, s, cols[i] || col));
    else if (m.type === 7) pts.forEach((q, i) => sphere(A, { q: po.q, p: xf(po, q) }, s, cols[i] || col));
    else if (m.type === 4) { for (let i = 0; i + 1 < pts.length; i++) line(L, po, pts[i], pts[i + 1], col); }
    else if (m.type === 5) { for (let i = 0; i + 1 < pts.length; i += 2) line(L, po, pts[i], pts[i + 1], col); }
    else if (m.type === 8) pts.forEach((q, i) => put(Pc, xf(po, q), cols[i] || col));
    else if (m.type === 11) { for (let i = 0; i + 2 < pts.length; i += 3) tri(A, po, pts[i], pts[i + 1], pts[i + 2], cols[i / 3 | 0] || col); }
    else if (m.type === 9) labels.push({ p: po.p, t: m.text, c: `rgb(${col[0] * 255 | 0},${col[1] * 255 | 0},${col[2] * 255 | 0})` });
  }
  // ── 6-DOF 인터랙티브 마커 — 프레임/월드 변환, 화면투영, 레이, 축/링 드래그 수학 ──
  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };
  const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
  const frameW = (fid) => { let q = [0, 0, 0, 1], p = [0, 0, 0]; const fr = fid && frameMap[fid]; if (fr) { q = fr.q; p = fr.p; } const g = computeG(); if (g) { q = qmul(g.q, q); p = applyG(g, p); } return { q, p }; };
  const imWorld = (im) => { const W = frameW(im.frame_id), lp = im.pose.p, lq = im.pose.q, wp = qrot(W.q, lp); return { q: qmul(W.q, lq), p: [wp[0] + W.p[0], wp[1] + W.p[1], wp[2] + W.p[2]] }; };
  const imLocal = (im, wq, wp) => { const W = frameW(im.frame_id), cq = qconj(W.q); return { q: qmul(cq, wq), p: qrot(cq, [wp[0] - W.p[0], wp[1] - W.p[1], wp[2] - W.p[2]]) }; };
  const screenOf = (w) => { const m = mvpMat(), x = w[0], y = w[1], z = w[2], cw = m[3] * x + m[7] * y + m[11] * z + m[15]; if (cw <= 1e-6) return null; return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * cv.clientWidth, (-(m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5) * cv.clientHeight]; };
  const screenRay = (cx, cy) => {
    const rect = cv.getBoundingClientRect(), nx = (cx - rect.left) / cv.clientWidth * 2 - 1, ny = -((cy - rect.top) / cv.clientHeight * 2 - 1), inv = inv16(mvpMat());
    if (!inv) return null;
    const un = (zz) => { const w = inv[3] * nx + inv[7] * ny + inv[11] * zz + inv[15]; return [(inv[0] * nx + inv[4] * ny + inv[8] * zz + inv[12]) / w, (inv[1] * nx + inv[5] * ny + inv[9] * zz + inv[13]) / w, (inv[2] * nx + inv[6] * ny + inv[10] * zz + inv[14]) / w]; };
    const a = un(-1), b = un(1);
    return { o: a, d: v3.sub(b, a) };
  };
  const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
  const axisColor = (ax) => { const a = [Math.abs(ax[0]), Math.abs(ax[1]), Math.abs(ax[2])]; if (a[0] >= a[1] && a[0] >= a[2]) return [0.95, 0.4, 0.4, 1]; if (a[1] >= a[2]) return [0.45, 0.9, 0.5, 1]; return [0.45, 0.6, 1, 1]; };
  const ringBasis = (N) => { const e1 = v3.norm(Math.abs(N[2]) < 0.9 ? v3.cross(N, [0, 0, 1]) : v3.cross(N, [1, 0, 0])); return [e1, v3.cross(N, e1)]; };
  // 레이(O,D)에 가장 가까운 축선(P0+A t)의 파라미터 t — 축 이동 드래그.
  const axisParam = (P0, A, O, D) => { const w0 = v3.sub(P0, O), a = v3.dot(A, A), b = v3.dot(A, D), c = v3.dot(D, D), d = v3.dot(A, w0), e = v3.dot(D, w0), den = a * c - b * b; return Math.abs(den) < 1e-9 ? d / a : (b * e - c * d) / den; };
  // 중심 C, 법선 N 평면에 레이 투영 → 링 위 각도(회전 드래그).
  const ringAngle = (C, N, ray) => { const dn = v3.dot(N, ray.d); if (Math.abs(dn) < 1e-9) return 0; const u = v3.dot(N, v3.sub(C, ray.o)) / dn, hit = v3.add(ray.o, v3.scale(ray.d, u)), vec = v3.sub(hit, C), be = ringBasis(N); return Math.atan2(v3.dot(vec, be[1]), v3.dot(vec, be[0])); };
  function pickIm(cx, cy) {   // (cx,cy: 캔버스 상대) 화면상 핸들 최근접 히트테스트
    let best = null, bestD = 14;
    for (const im of ims.values()) {
      if (!im.visible || !(im.handles && im.handles.length)) continue;
      const w = imWorld(im), s = (im.scale || 1) * 0.9;
      for (const h of im.handles) {
        const ax = v3.norm(qrot(w.q, h.axis));
        if (h.mode === 'move') {
          const a = screenOf(v3.add(w.p, v3.scale(ax, s))), b = screenOf(v3.sub(w.p, v3.scale(ax, s)));
          if (!a || !b) continue;
          const dd = segDist(cx, cy, a[0], a[1], b[0], b[1]);
          if (dd < bestD) { bestD = dd; best = { im, h }; }
        } else {
          const bs = ringBasis(ax), R = s * 0.85;
          let md = 1e9;
          for (let i = 0; i < 28; i++) { const t = i / 28 * 2 * Math.PI, pnt = screenOf(v3.add(w.p, v3.add(v3.scale(bs[0], R * Math.cos(t)), v3.scale(bs[1], R * Math.sin(t))))); if (pnt) { const q = Math.hypot(cx - pnt[0], cy - pnt[1]); if (q < md) md = q; } }
          if (md < bestD) { bestD = md; best = { im, h }; }
        }
      }
    }
    return best;
  }
  function startImDrag(hit, e) {
    const w = imWorld(hit.im), axW = v3.norm(qrot(w.q, hit.h.axis)), ray = screenRay(e.clientX, e.clientY);
    const st = { im: hit.im, h: hit.h, axW, startWorld: { q: w.q.slice(), p: w.p.slice() } };
    if (hit.h.mode === 'move') st.t0 = ray ? axisParam(w.p, axW, ray.o, ray.d) : 0;
    else st.ang0 = ray ? ringAngle(w.p, axW, ray) : 0;
    if (imHandler) imHandler(hit.im.name, hit.im.pose, 'mouse_down', hit.h.name);
    return st;
  }
  function updateImDrag(e) {
    const st = imDrag, ray = screenRay(e.clientX, e.clientY);
    if (!ray) return;
    let wp = st.startWorld.p, wq = st.startWorld.q;
    if (st.h.mode === 'move') { const t = axisParam(st.startWorld.p, st.axW, ray.o, ray.d); wp = v3.add(st.startWorld.p, v3.scale(st.axW, t - st.t0)); }
    else { const dA = ringAngle(st.startWorld.p, st.axW, ray) - st.ang0, hh = dA / 2, sn = Math.sin(hh); wq = qmul([st.axW[0] * sn, st.axW[1] * sn, st.axW[2] * sn, Math.cos(hh)], st.startWorld.q); }
    st.im.pose = imLocal(st.im, wq, wp);
    rebuildScene();
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (imHandler && now - imFeedT > 40) { imFeedT = now; imHandler(st.im.name, st.im.pose, 'pose_update', st.h.name); }
  }
  function finishImDrag() { if (imDrag && imHandler) imHandler(imDrag.im.name, imDrag.im.pose, 'mouse_up', imDrag.h.name); }
  // 씬 지오메트리(그리드·좌표축·TF·마커)만 재구성 — 마커/TF/opts 변경 시에만 호출(클라우드와 분리).
  function rebuildScene() {
    const L = [], T = [], TA = [], Pc = [];
    labels = [];
    if (opt.axes) { const O = { q: [0, 0, 0, 1], p: [0, 0, 0] }; line(L, O, [0, 0, 0], [1.2, 0, 0], [0.9, 0.35, 0.35, 1]); line(L, O, [0, 0, 0], [0, 1.2, 0], [0.44, 0.82, 0.55, 1]); line(L, O, [0, 0, 0], [0, 0, 1.2], [0.4, 0.6, 0.95, 1]); }
    frameMap = {};
    for (const f of frames) frameMap[f.id] = { p: f.p || [0, 0, 0], q: f.q || [0, 0, 0, 1] };
    const g = computeG();
    for (const f of frames) {
      let po = { q: f.q || [0, 0, 0, 1], p: f.p || [0, 0, 0] };
      if (g) po = { q: qmul(g.q, po.q), p: applyG(g, po.p) };
      line(L, po, [0, 0, 0], [0.3, 0, 0], [0.9, 0.35, 0.35, 1]);
      line(L, po, [0, 0, 0], [0, 0.3, 0], [0.44, 0.82, 0.55, 1]);
      line(L, po, [0, 0, 0], [0, 0, 0.3], [0.4, 0.6, 0.95, 1]);
      labels.push({ p: po.p, t: f.id, c: '#9aa7b8' });
    }
    // frame_id → 루트 기준 변환(TF), 이후 고정 프레임 g 적용. 마커/디스플레이를 해당 프레임에 배치(RViz 식).
    for (const set of markerSets.values()) {
      if (!set.visible) continue;
      for (const m of set.markers) {
        if (m.action === 2 || m.action === 3) continue;
        let po = { q: (m.pose && m.pose.q) || [0, 0, 0, 1], p: (m.pose && m.pose.p) || [0, 0, 0] };
        const fr = m.frame_id && frameMap[m.frame_id];
        if (fr) { const wp = qrot(fr.q, po.p); po = { q: qmul(fr.q, po.q), p: [wp[0] + fr.p[0], wp[1] + fr.p[1], wp[2] + fr.p[2]] }; }
        if (g) po = { q: qmul(g.q, po.q), p: applyG(g, po.p) };
        emitMarker(m, po, L, T, TA, Pc, labels);
      }
    }
    // ── 인터랙티브 마커 — 비주얼 지오메트리 + 6-DOF 기즈모(이동 화살표선 · 회전 링) ──
    for (const im of ims.values()) {
      if (!im.visible) continue;
      const w = imWorld(im), base = { q: w.q, p: w.p }, O0 = { q: [0, 0, 0, 1], p: [0, 0, 0] };
      for (const m of (im.visual || [])) { const po = { q: qmul(w.q, (m.pose && m.pose.q) || [0, 0, 0, 1]), p: xf(base, (m.pose && m.pose.p) || [0, 0, 0]) }; emitMarker(m, po, L, T, TA, Pc, labels); }
      const s = (im.scale || 1) * 0.9;
      for (const h of (im.handles || [])) {
        const ax = v3.norm(qrot(w.q, h.axis)), hot = imDrag && imDrag.im === im && imDrag.h === h, c = hot ? [1, 0.9, 0.3, 1] : axisColor(h.axis);
        if (h.mode === 'move') { line(L, O0, v3.add(w.p, v3.scale(ax, s)), v3.sub(w.p, v3.scale(ax, s)), c); box(T, { q: w.q, p: v3.add(w.p, v3.scale(ax, s)) }, [s * 0.09, s * 0.09, s * 0.09], c); }
        else { const bs = ringBasis(ax), R = s * 0.85; let prev = null; for (let i = 0; i <= 40; i++) { const t = i / 40 * 2 * Math.PI, pnt = v3.add(w.p, v3.add(v3.scale(bs[0], R * Math.cos(t)), v3.scale(bs[1], R * Math.sin(t)))); if (prev) line(L, O0, prev, pnt, c); prev = pnt; } }
      }
      labels.push({ p: [w.p[0], w.p[1], w.p[2] + s * 1.15], t: im.name, c: '#c8d2df' });
    }
    if (pin) { put(Pc, pin.p, [1, 0.82, 0.29, 1]); labels.push({ p: pin.p, t: pin.t, c: '#ffd24a' }); }   // 조회 핀(월드 고정)
    upload('line', new Float32Array(L));
    upload('tri', new Float32Array(T));
    upload('triA', new Float32Array(TA));
    upload('pts', new Float32Array(Pc));   // 마커 POINTS(항상 그림, 소량)
    worldF = new Float32Array(gMat4());   // 클라우드 고정프레임 행렬 캐시(프레임당 재계산 제거) — g 는 여기서만 바뀜
    invalidate();
  }
  // 클라우드만 업로드 — 점당 (x,y,z,c) stride4. 보이는 디스플레이 병합(단일이면 복사 없음) → xyzc 버퍼. 색은 GPU.
  function uploadCloud() {
    const vis = [];
    let total = 0;
    for (const c of clouds.values()) if (c.visible && c.data.length) { vis.push(c.data); total += (c.data.length / 4 | 0); }
    cloudN = total;
    if (!total) { gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW); return; }
    const src = vis.length === 1 ? vis[0] : (() => { const m = new Float32Array(total * 4); let o = 0; for (const a of vis) { m.set(a, o); o += a.length; } return m; })();
    let mn = Infinity, mx = -Infinity, cn = Infinity, cx = -Infinity;
    for (let i = 0; i < total; i++) { const z = src[i * 4 + 2], cc = src[i * 4 + 3]; if (z < mn) mn = z; if (z > mx) mx = z; if (cc < cn) cn = cc; if (cc > cx) cx = cc; }
    zmin = mn; zmax = mx; cmin = cn; cmax = cx;
    let out;
    // 거리 LOD 는 셰이더가 처리 → 보통은 무복사 업로드. 하드 상한(maxPoints)이 걸릴 때만 대표성 순열로 프리픽스 샘플.
    if (opt.maxPoints > 0 && opt.maxPoints < total) {
      if (permCache.n !== total) { permCache.perm = stridePermute(total); permCache.n = total; }
      const perm = permCache.perm;
      out = new Float32Array(total * 4);
      for (let k = 0; k < total; k++) { const i = perm[k]; out[k * 4] = src[i * 4]; out[k * 4 + 1] = src[i * 4 + 1]; out[k * 4 + 2] = src[i * 4 + 2]; out[k * 4 + 3] = src[i * 4 + 3]; }
    } else out = src;
    gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    invalidate();
  }
  function bind(k) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 28, 12); }
  function projectLabels(mvp) {
    if (!labelDiv) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    let u = 0;
    for (const l of labels) {
      const x = l.p[0], y = l.p[1], z = l.p[2];
      const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12], cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13], cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (cw <= 0) continue;
      const sx = (cx / cw * 0.5 + 0.5) * W, sy = (-cy / cw * 0.5 + 0.5) * H;
      let sp = labelPool[u];
      if (!sp) { sp = document.createElement('span'); sp.style.cssText = 'position:absolute;font:11px monospace;transform:translate(-50%,-50%);pointer-events:none;text-shadow:0 0 3px #0d1116'; labelDiv.append(sp); labelPool.push(sp); }
      sp.style.display = '';
      sp.textContent = l.t;
      sp.style.left = sx + 'px';
      sp.style.top = sy + 'px';
      sp.style.color = l.c;
      u++;
    }
    for (let i = u; i < labelPool.length; i++) labelPool[i].style.display = 'none';
  }
  function draw() {
    const W = cv.clientWidth || 900, H = cv.clientHeight || 520;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    if (opt.follow && frameMap[opt.follow]) center = applyG(computeG(), frameMap[opt.follow].p);   // 프레임 추종: 카메라 중심 = 그 프레임 위치
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = mvpMat(), mvpF = new Float32Array(mvp);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uMVP, false, mvpF);
    gl.uniform1f(uRound, 0);
    gl.depthMask(true);
    if (nV.tri) { bind('tri'); gl.drawArrays(gl.TRIANGLES, 0, nV.tri); }
    if (nV.line) { bind('line'); gl.drawArrays(gl.LINES, 0, nV.line); }
    if (nV.pts) { gl.uniform1f(uPS, psize); gl.uniform1f(uRound, 1); bind('pts'); gl.drawArrays(gl.POINTS, 0, nV.pts); gl.uniform1f(uRound, 0); }
    // 클라우드 — 전용 셰이더(GPU 높이색) + 거리 LOD(멀수록 앞쪽 일부만, 순열로 대표성 유지).
    if (cloudN) {
      gl.useProgram(cprog);
      gl.uniformMatrix4fv(cuMVP, false, mvpF);
      gl.uniformMatrix4fv(cuWorld, false, worldF);
      gl.uniform1f(cuPS, psize);
      gl.uniform1f(cuZmin, zmin);
      gl.uniform1f(cuZmax, zmax);
      gl.uniform1f(cuLod, opt.lodMode === 'off' ? 0 : opt.lodDist);
      gl.uniform1f(cuRound, opt.round ? 1 : 0);
      gl.uniform1f(cuCM, opt.colorMode);
      gl.uniform1f(cuCmin, cmin);
      gl.uniform1f(cuCmax, cmax);
      gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuf);
      gl.vertexAttribPointer(caP, 3, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(caC, 1, gl.FLOAT, false, 16, 12);
      const dc = opt.maxPoints > 0 ? Math.min(cloudN, opt.maxPoints) : cloudN;
      lastDrawn = dc;   // 셰이더가 거리 LOD 로 추가 컬링
      gl.drawArrays(gl.POINTS, 0, dc);
      gl.useProgram(prog);
    } else lastDrawn = 0;
    if (nV.triA) { gl.depthMask(false); bind('triA'); gl.drawArrays(gl.TRIANGLES, 0, nV.triA); gl.depthMask(true); }
    // 카메라 이미지 3D 투영 — 광학 프레임에 FOV 크기 텍스처 쿼드(카메라 프레임 TF ∘ 고정프레임 g).
    if (camState.on && camState.ready) {
      const fr = frameMap[camState.frame], g = computeG(), d = camState.dist, hw = d * (camState.W / 2) / camState.fx, hh = d * (camState.H / 2) / camState.fy;
      const loc = [[-hw, -hh, d, 0, 0], [hw, -hh, d, 1, 0], [hw, hh, d, 1, 1], [-hw, -hh, d, 0, 0], [hw, hh, d, 1, 1], [-hw, hh, d, 0, 1]];
      const vd = [];
      for (const c of loc) { let pt = [c[0], c[1], c[2]]; if (fr) { const r = qrot(fr.q, pt); pt = [r[0] + fr.p[0], r[1] + fr.p[1], r[2] + fr.p[2]]; } if (g) pt = applyG(g, pt); vd.push(pt[0], pt[1], pt[2], c[3], c[4]); }
      gl.useProgram(tprog);
      gl.uniformMatrix4fv(tuMVP, false, mvpF);
      gl.uniform1f(tuAlpha, camState.alpha);
      gl.uniform1i(tuTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, camBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vd), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(taP, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(taUV, 2, gl.FLOAT, false, 20, 12);
      gl.depthMask(camState.alpha > 0.99);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.useProgram(prog);
    }
    projectLabels(mvp);
    frameN++;
    const now = (typeof performance !== 'undefined' ? performance.now() : fpsClock + 16);
    if (now - fpsClock >= 500) {
      fps = Math.round(frameN * 1000 / (now - fpsClock));
      frameN = 0;
      fpsClock = now;
      // 적응형 LOD — FPS 가 목표보다 낮으면 거리 임계(lodDist)를 낮춰 먼 점을 더 솎고, 여유 있으면 높여 디테일 복원.
      if (opt.lodMode === 'adaptive' && cloudN) { if (fps < opt.targetFps - 5) opt.lodDist = Math.max(3, opt.lodDist * 0.85); else if (fps > opt.targetFps + 8) opt.lodDist = Math.min(200, opt.lodDist * 1.12); }
    }
  }
  let drag = null, btn = 0, pickHandler = null, inspectCb = null, pin = null, ctxCb = null, rcDown = null;
  // 3D 포인트 조회 — 커서에 가장 가까운(화면상) 클라우드 점을 찾아 월드좌표·값·최근접 프레임 반환. RViz엔 없는 편의.
  function pickPointInternal(cx, cy) {
    const rect = cv.getBoundingClientRect(), W = cv.clientWidth, H = cv.clientHeight, px = cx - rect.left, py = cy - rect.top;
    const M = mul(mvpMat(), gMat4());   // clip = mvp * world * p (셰이더와 동일)
    const R2 = 18 * 18; let best = null, bestScore = 1e18;
    for (const c of clouds.values()) { if (!c.visible || !c.data || !c.data.length) continue; const d = c.data, n = d.length / 4 | 0;
      for (let i = 0; i < n; i++) { const x = d[i * 4], y = d[i * 4 + 1], z = d[i * 4 + 2];
        const cw = M[3] * x + M[7] * y + M[11] * z + M[15]; if (cw <= 1e-6) continue;
        const sx = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / cw * 0.5 + 0.5) * W, sy = (-(M[1] * x + M[5] * y + M[9] * z + M[13]) / cw * 0.5 + 0.5) * H;
        const ddx = sx - px, ddy = sy - py, sd2 = ddx * ddx + ddy * ddy; if (sd2 > R2) continue;
        const score = cw + sd2 * 0.002;   // 반경 내에서 카메라에 가장 가까운(앞쪽) 점 우선
        if (score < bestScore) { bestScore = score; best = { x, y, z, c: d[i * 4 + 3] }; } } }
    if (!best) return null;
    const g = gMat4(), x = best.x, y = best.y, z = best.z;   // 렌더되는 월드 위치 = world * p
    const world = [g[0] * x + g[4] * y + g[8] * z + g[12], g[1] * x + g[5] * y + g[9] * z + g[13], g[2] * x + g[6] * y + g[10] * z + g[14]];
    let nf = null, nfd = 1e18;
    for (const id in frameMap) { const fp = frameW(id).p, dd = Math.hypot(fp[0] - world[0], fp[1] - world[1], fp[2] - world[2]); if (dd < nfd) { nfd = dd; nf = id; } }
    return { world, value: best.c, colorMode: opt.colorMode, frame: nf, frameDist: nfd };
  }
  cv.addEventListener('mousedown', (e) => {
    if (inspectCb && e.button === 0) { inspectCb(pickPointInternal(e.clientX, e.clientY), e); e.preventDefault(); return; }
    if (pickHandler && e.button === 0) { const w = pickGround(e.clientX, e.clientY); if (w) { pickHandler(w, e); e.preventDefault(); return; } }
    if (e.button === 0 && ims.size) { const rect = cv.getBoundingClientRect(); const hit = pickIm(e.clientX - rect.left, e.clientY - rect.top); if (hit) { imDrag = startImDrag(hit, e); rebuildScene(); cv.style.cursor = 'grabbing'; e.preventDefault(); return; } }
    if (e.button === 2) rcDown = { x: e.clientX, y: e.clientY };   // 우클릭 시작 지점(드래그=팬, 제자리클릭=컨텍스트 메뉴)
    drag = { x: e.clientX, y: e.clientY };
    btn = e.button;
    cv.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => { if (imDrag) { finishImDrag(); imDrag = null; rebuildScene(); }
    if (rcDown) { const moved = Math.hypot(e.clientX - rcDown.x, e.clientY - rcDown.y); if (moved < 5 && ctxCb) ctxCb(pickGround(rcDown.x, rcDown.y), e); rcDown = null; }
    drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('mousemove', (e) => {
    if (imDrag) { updateImDrag(e); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    if (btn === 2) { pan[0] += dx * dist * 0.002; pan[1] -= dy * dist * 0.002; } else { yaw += dx * 0.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * 0.01)); }
    invalidate();
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); dist *= e.deltaY < 0 ? 0.9 : 1.1; invalidate(); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // ── WASD 이동 — 씬 위에 마우스를 둔 채 FPS 식 워킹(W/S 전후, A/D 좌우, Q/E 상하) + 화살표 회전 ──
  let hover = false; const keys = new Set();
  cv.addEventListener('mouseenter', () => { hover = true; });
  cv.addEventListener('mouseleave', () => { hover = false; keys.clear(); });
  const MOVEK = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  const kd = (e) => { if (!hover) return; const tag = document.activeElement && document.activeElement.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; const k = e.key.toLowerCase(); if (MOVEK.has(k)) { keys.add(k); e.preventDefault(); invalidate(); } };
  const ku = (e) => { keys.delete(e.key.toLowerCase()); };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  function applyMove() {
    if (!keys.size) return;
    const step = dist * 0.02, fwd = [Math.sin(yaw), Math.cos(yaw)], rt = [Math.cos(yaw), -Math.sin(yaw)]; let mx = 0, my = 0, mz = 0;
    if (keys.has('w')) { mx += fwd[0]; my += fwd[1]; }
    if (keys.has('s')) { mx -= fwd[0]; my -= fwd[1]; }
    if (keys.has('d')) { mx += rt[0]; my += rt[1]; }
    if (keys.has('a')) { mx -= rt[0]; my -= rt[1]; }
    if (keys.has('e')) mz += 1;
    if (keys.has('q')) mz -= 1;
    if (!opt.follow) { center[0] += mx * step; center[1] += my * step; center[2] += mz * step; }   // 추종 중엔 이동 무시(프레임이 중심)
    if (keys.has('arrowleft')) yaw -= 0.03;
    if (keys.has('arrowright')) yaw += 0.03;
    if (keys.has('arrowup')) pitch = Math.min(1.55, pitch + 0.025);
    if (keys.has('arrowdown')) pitch = Math.max(-1.55, pitch - 0.025);
    invalidate();
  }
  rebuildScene();   // 그리드·좌표축을 데이터 도착 전에도 표시
  // 렌더 루프 — 클라우드 스트리밍(FPS/적응형 LOD 유효), 드래그·추종, 또는 dirty(데이터/카메라 변경) 시에만 draw.
  // 그 외 정지 상태에선 GL 작업을 건너뛰어 브라우저 GPU 부하 제거(preserveDrawingBuffer 아니어도 화면 유지).
  function loop() {
    if (!alive) return;
    const W = cv.clientWidth || 900, H = cv.clientHeight || 520;
    if (cv.width !== W || cv.height !== H) dirty = true;   // 리사이즈 감지
    if (hover && keys.size) applyMove();
    if (dirty || cloudN || opt.follow || imDrag || drag || (hover && keys.size)) { dirty = false; draw(); }
    if (!(SNAP && ++loop.n > 300)) raf = requestAnimationFrame(loop);
  }
  loop.n = 0;
  loop();
  return {
    // 기본(단일) 디스플레이 — 하위호환. id 판(setCloudById/…)은 RViz 식 다중 디스플레이용.
    // 클라우드 setter 는 uploadCloud 만(씬 지오메트리 재구성 없음) → 고빈도 프레임 최적화.
    setCloud(f) { if (f && f.length) { const ex = clouds.get('_'); clouds.set('_', { data: f, visible: ex ? ex.visible : true }); } else clouds.delete('_'); uploadCloud(); },
    setMarkers(m) { const ex = markerSets.get('_'); markerSets.set('_', { markers: m || [], visible: ex ? ex.visible : true }); rebuildScene(); },
    setCloudById(id, f) { if (f && f.length) { const ex = clouds.get(id); clouds.set(id, { data: f, visible: ex ? ex.visible : true }); } else clouds.delete(id); uploadCloud(); },
    setMarkersById(id, m) { const ex = markerSets.get(id); markerSets.set(id, { markers: m || [], visible: ex ? ex.visible : true }); rebuildScene(); },
    setVisible(kind, id, on) { const map = kind === 'cloud' ? clouds : markerSets; const d = map.get(id); if (d) { d.visible = !!on; kind === 'cloud' ? uploadCloud() : rebuildScene(); } },
    removeDisplay(kind, id) { (kind === 'cloud' ? clouds : markerSets).delete(id); kind === 'cloud' ? uploadCloud() : rebuildScene(); },
    setTF(f) { frames = f || []; rebuildScene(); },
    opts(o) { Object.assign(opt, o); rebuildScene(); },
    view(p) { pan = [0, 0]; if (p === 'top') { yaw = 0; pitch = -1.554; } else if (p === 'front') { yaw = 0; pitch = 0; } else if (p === 'side') { yaw = Math.PI / 2; pitch = 0; } else if (p === 'back') { yaw = Math.PI; pitch = 0; } else { yaw = 0.7; pitch = -0.6; dist = 12; center = [0, 0, 0.5]; } invalidate(); },
    setPointSize(s) { psize = s; invalidate(); },
    setPickHandler(fn) { pickHandler = fn; cv.style.cursor = fn ? 'crosshair' : 'grab'; },
    setInspect(fn) { inspectCb = fn; cv.style.cursor = fn ? 'crosshair' : 'grab'; if (!fn) { pin = null; rebuildScene(); } },
    setPin(worldPt, text) { pin = worldPt ? { p: worldPt, t: text || '' } : null; rebuildScene(); },
    setContextHandler(fn) { ctxCb = fn; },
    setCamImage(imgEl, cam, frame) {
      if (!imgEl || !cam || !cam.K) return;
      camState.W = cam.width || imgEl.naturalWidth || 640;
      camState.H = cam.height || imgEl.naturalHeight || 480;
      camState.fx = cam.K[0] || 500;
      camState.fy = cam.K[4] || 500;
      camState.frame = frame || cam.frame_id || '';
      camState.on = true;
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgEl);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        camState.ready = true;
      } catch (_) { /* */ }
      invalidate();
    },
    setCamOpts(o) { Object.assign(camState, o); invalidate(); },
    clearCamera() { camState.on = false; camState.ready = false; invalidate(); },
    setInteractiveMarkers(list) { ims.clear(); for (const im of (list || [])) if (im && im.name) ims.set(im.name, { ...im, visible: true }); rebuildScene(); },
    setImHandler(fn) { imHandler = fn; },
    getStats() { return { fps, points: cloudN, drawn: cloudN ? lastDrawn : 0, lodDist: opt.lodDist, lodMode: opt.lodMode, active: !!(cloudN || imDrag || drag || opt.follow || (hover && keys.size)), center: center.slice() }; },
    dispose() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); if (labelDiv) labelDiv.innerHTML = ''; try { for (const k in bufs) gl.deleteBuffer(bufs[k]); gl.deleteBuffer(cloudBuf); gl.deleteProgram(prog); gl.deleteProgram(cprog); } catch (_) { /* */ } },
  };
}

// 🧊 3D 씬 — RViz 식 Displays 패널: 여러 토픽(클라우드/마커)을 동시에 씬에 올리고 체크박스로 표시/숨김,
//   TF·그리드·축·LOD 내장 디스플레이, 거리 LOD 렌더, FPS·점수·벽시계/시뮬시각 표시.
export function cloud(it) {
  const cloudTopics = () => state.items.filter((i) => (i.ty || '').includes('PointCloud2')).map((i) => i.name);
  const markerTopics = () => state.items.filter((i) => /visualization_msgs\/(msg\/)?Marker(Array)?/.test(i.ty || '')).map((i) => i.name);
  const GEOMRE = /LaserScan|nav_msgs\/(msg\/)?Path|Odometry|PoseArray|PoseStamped|PointStamped|OccupancyGrid|VehicleOdometry/;
  const geomTopics = () => state.items.filter((i) => GEOMRE.test(i.ty || '')).map((i) => [i.name, i.ty || '']);
  const imgTopics = () => state.items.filter((i) => /CompressedImage|sensor_msgs\/(msg\/)?Image/.test(i.ty || '')).map((i) => i.name);
  const camInfoTopics = () => state.items.filter((i) => /CameraInfo/.test(i.ty || '')).map((i) => i.name);
  const imTopics = () => state.items.filter((i) => /InteractiveMarkerUpdate/.test(i.ty || '')).map((i) => i.name.replace(/\/update$/, ''));
  const camImgEl = new Image();
  let camImgES = null, camInfES = null, camObj = null;
  const subCamImg = (t) => { if (camImgES) { camImgES.close(); camImgES = null; } if (!t) { scene.clearCamera(); return; } camImgES = openStream('/imgstream?topic=' + encodeURIComponent(t), (d) => { if (!d) return; camImgEl.onload = () => { if (camObj) scene.setCamImage(camImgEl, camObj, camObj.frame_id); }; camImgEl.src = 'data:image/jpeg;base64,' + d; }); };
  const subCamInf = (t) => { if (camInfES) { camInfES.close(); camInfES = null; } if (!t) return; camInfES = openStream('/caminfostream?topic=' + encodeURIComponent(t), (d) => { try { camObj = JSON.parse(d); } catch (_) { /* */ } }); };
  const cv = el('canvas', { width: 900, height: 560, style: 'width:100%;height:560px;background:#0b0e12;border:1px solid var(--line);border-radius:6px;cursor:grab;display:block' });
  const labelDiv = el('div', { style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden' });
  const fpsOv = el('div', { style: 'position:absolute;left:8px;top:8px;font:11px monospace;color:#9aa7b8;background:rgba(13,17,22,.6);padding:2px 7px;border-radius:4px;pointer-events:none' });
  const stage = el('div', { style: 'position:relative;flex:1;min-width:0' }, cv, labelDiv, fpsOv);
  const info = el('div', { class: 'hint', style: 'margin-top:4px' }, '드래그=회전 · 휠=줌 · 우클릭드래그=이동 · WASD=이동 Q/E=상하 화살표=회전 · 우클릭=메뉴 · 기즈모 드래그=마커');
  const scene = mkScene(cv, labelDiv, info);
  const displays = new Map();   // id → {id,kind,topic,es,on}
  const idOf = (kind, topic) => kind + ':' + topic;
  let cloudMode = 'xyz', colorSel = null, frameIds = [], lastFrameIds = '';   // 클라우드 채널 + TF 프레임 목록(카메라 옵션용)
  const subscribe = (d) => {
    if (d.kind === 'cloud') { d.es = openStream('/cloudstream?topic=' + encodeURIComponent(d.topic), (data) => { const r = decodeCloud(data); if (!r) return; cloudMode = r.mode; if (colorSel && colorSel.value === 'auto') applyAutoColor(); scene.setCloudById(d.id, r.arr); }); }
    else if (d.kind === 'geom') { d.es = openStream('/geomstream?topic=' + encodeURIComponent(d.topic) + '&type=' + encodeURIComponent(d.ty || ''), (data) => { try { const o = JSON.parse(data); const ms = o.markers || []; if (ms[0] && ms[0].frame_id) d.frame = ms[0].frame_id; scene.setMarkersById(d.id, ms); } catch (_) { /* */ } }); }
    else if (d.kind === 'im') {
      d.es = openStream('/imstream?topic=' + encodeURIComponent(d.topic), (data) => { try { const o = JSON.parse(data); scene.setInteractiveMarkers(o.ims || []); } catch (_) { /* */ } });
      scene.setImHandler((name, pose, event, control) => { if (d.es) d.es.feed({ name, pose, event, control }); });   // 기즈모 드래그 → <topic>/feedback 발행
    } else { d.es = openStream('/markerstream?topic=' + encodeURIComponent(d.topic), (data) => { try { const o = JSON.parse(data); const ms = o.markers || (Array.isArray(o) ? o : [o]); if (ms[0] && ms[0].frame_id) d.frame = ms[0].frame_id; scene.setMarkersById(d.id, ms); } catch (_) { /* */ } }); }
  };
  const applyAutoColor = () => scene.opts({ colorMode: cloudMode === 'rgb' ? 2 : cloudMode === 'intensity' ? 1 : 0 });
  const unsubscribe = (d) => { if (d.es) { d.es.close(); d.es = null; } if (d.kind === 'cloud') scene.setCloudById(d.id, null); else if (d.kind === 'im') { scene.setInteractiveMarkers([]); scene.setImHandler(null); } else scene.setMarkersById(d.id, []); };
  const addDisplay = (kind, topic, ty) => { const id = idOf(kind, topic); if (displays.has(id)) return; const d = { id, kind, topic, ty, on: true }; displays.set(id, d); subscribe(d); renderList(); };
  const toggle = (d) => { d.on = !d.on; if (d.on) subscribe(d); else unsubscribe(d); renderList(); };
  const removeD = (d) => { unsubscribe(d); scene.removeDisplay(d.kind, d.id); displays.delete(d.id); renderList(); };
  const builtin = { axes: true, tf: true, robot: false };
  let tfES = null, urdfES = null;
  const subTF = (on) => { if (tfES) { tfES.close(); tfES = null; } scene.setTF([]); if (!on) return; tfES = openStream('/tfstream', (data) => { try { const o = JSON.parse(data); const fr = o.frames || []; scene.setTF(fr); const ids = fr.map((f) => f.id).join(','); if (ids !== lastFrameIds) { lastFrameIds = ids; frameIds = fr.map((f) => f.id); renderCam(); } } catch (_) { /* */ } }); };
  const subRobot = (on) => { if (urdfES) { urdfES.close(); urdfES = null; } scene.setMarkersById('__robot__', []); if (!on) return; urdfES = openStream('/urdfstream', (data) => { try { const o = JSON.parse(data); scene.setMarkersById('__robot__', o.markers || []); } catch (_) { /* */ } }); };
  const listBox = el('div', {});
  let followFrame = null;   // 현재 추종 중인 프레임(디스플레이 우클릭으로 토글)
  const setFollow = (frame) => { followFrame = frame || null; scene.opts({ follow: followFrame }); if (typeof CO !== 'undefined') { CO.follow = followFrame || ''; } if (typeof renderCam === 'function') renderCam(); if (!followFrame) scene.view('iso'); };
  const followDisplay = (d) => {
    if (!d.frame) { toast('이 디스플레이는 프레임 정보가 없음(데이터 수신 후 다시)', 'warn'); return; }
    if (followFrame === d.frame) { setFollow(null); toast('추종 해제', 'info'); } else { setFollow(d.frame); toast('추종: ' + d.frame, 'ok'); }
    renderList();
  };
  const DR = 'display:flex;align-items:center;gap:5px;padding:2px 4px;font-size:11px;cursor:default';
  function renderList() {
    listBox.innerHTML = '';
    const chk = (label, key, fn) => { const c = el('input', { type: 'checkbox' }); c.checked = builtin[key]; c.onchange = () => { builtin[key] = c.checked; fn(c.checked); }; return el('label', { style: DR }, c, el('span', {}, label)); };
    listBox.append(el('div', { class: 'hint', style: 'margin:4px 0 2px;text-transform:uppercase;letter-spacing:.05em' }, '내장'));
    listBox.append(chk('Axes', 'axes', (v) => scene.opts({ axes: v })), chk('TF', 'tf', (v) => subTF(v)), chk('RobotModel (URDF)', 'robot', (v) => subRobot(v)));
    listBox.append(el('div', { class: 'hint', style: 'margin:6px 0 2px;text-transform:uppercase;letter-spacing:.05em' }, '디스플레이'));
    if (!displays.size) listBox.append(el('div', { class: 'hint', style: 'padding:2px 4px' }, '아래에서 토픽 추가'));
    const ICON = { cloud: '🌩 ', marker: '📐 ', geom: '🧭 ', im: '🎯 ' };
    for (const d of displays.values()) {
      const c = el('input', { type: 'checkbox' });
      c.checked = d.on;
      c.onchange = () => toggle(d);
      const rm = el('span', { style: 'cursor:pointer;color:var(--dim)', title: '제거', onclick: () => removeD(d) }, '✕');
      const followed = followFrame && d.frame === followFrame;
      const row = el('label', { style: DR + (followed ? ';color:var(--cyan)' : ''), title: (d.frame ? `프레임: ${d.frame}\n` : '') + '우클릭 → 추종(Follow)' },
        c, el('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, (followed ? '📍 ' : '') + (ICON[d.kind] || '') + d.topic), rm);
      row.oncontextmenu = (e) => { e.preventDefault(); followDisplay(d); };
      listBox.append(row);
    }
    const avail = [...cloudTopics().map((t) => ['cloud', t, '']), ...markerTopics().map((t) => ['marker', t, '']), ...geomTopics().map(([t, ty]) => ['geom', t, ty]), ...imTopics().map((t) => ['im', t, ''])].filter(([k, t]) => !displays.has(idOf(k, t)));
    const addSel = el('select', { style: 'width:100%;margin-top:5px;font:11px monospace' });
    addSel.append(el('option', { value: '' }, '＋ 토픽 추가…'));
    avail.forEach(([k, t]) => addSel.append(el('option', { value: k + '\0' + t }, (ICON[k] || '') + t)));
    addSel.onchange = () => { if (!addSel.value) return; const [k, t] = addSel.value.split('\0'); const ty = (geomTopics().find(([n]) => n === t) || [])[1] || ''; addDisplay(k, t, ty); };
    listBox.append(addSel);
  }
  const ptSize = el('input', { type: 'range', min: '1', max: '6', value: '2.4', step: '0.2', style: 'vertical-align:middle' });
  ptSize.oninput = () => scene.setPointSize(+ptSize.value);
  const vbtn = (t, p) => el('button', { class: 'act', style: 'padding:2px 7px', onclick: () => scene.view(p) }, t);
  const topbar = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px' },
    el('span', { style: 'display:inline-flex;gap:3px' }, vbtn('Top', 'top'), vbtn('Front', 'front'), vbtn('Side', 'side'), vbtn('Iso', 'iso')),
    el('label', { style: 'display:inline-flex;align-items:center;gap:4px' }, el('span', { class: 'hint' }, '점크기'), ptSize));
  // ── ⚙ 최적화 옵션(선택 가능) — LOD 모드/거리/목표FPS/최대점수/점모양 ──
  const O = { lodMode: 'adaptive', lodDist: 60, targetFps: 40, maxPoints: 0, round: true, color: 'auto' };
  const optBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
  const olbl = (t, node) => el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, t, node);
  function renderOpt() {
    optBox.innerHTML = '';
    optBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '⚙ 최적화'));
    const modeSel = el('select', { style: 'width:100%;font:11px monospace' });
    [['off', '끄기 (전량 렌더)'], ['distance', '거리 LOD'], ['adaptive', '적응형 (FPS 유지)']].forEach(([v, l]) => modeSel.append(el('option', { value: v }, l)));
    modeSel.value = O.lodMode;
    modeSel.onchange = () => { O.lodMode = modeSel.value; scene.opts({ lodMode: O.lodMode }); renderOpt(); };
    optBox.append(olbl('LOD 모드', modeSel));
    // 색상 모드 — 자동(채널 감지)/높이/Intensity/RGB/단색.
    colorSel = el('select', { style: 'width:100%;font:11px monospace' });
    [['auto', '자동 (채널 감지)'], ['0', '높이 (z)'], ['1', 'Intensity'], ['2', 'RGB'], ['3', '단색']].forEach(([v, l]) => colorSel.append(el('option', { value: v }, l)));
    colorSel.value = O.color;
    colorSel.onchange = () => { O.color = colorSel.value; if (O.color === 'auto') applyAutoColor(); else scene.opts({ colorMode: +O.color }); };
    optBox.append(olbl('색상', colorSel));
    if (O.lodMode !== 'off') {
      const d = el('input', { type: 'range', min: '5', max: '120', step: '1', value: String(Math.round(O.lodDist)), style: 'width:100%' });
      if (O.lodMode === 'adaptive') d.disabled = true;
      d.oninput = () => { O.lodDist = +d.value; scene.opts({ lodDist: O.lodDist }); };
      optBox.append(olbl(O.lodMode === 'adaptive' ? '거리 임계 (자동)' : '거리 임계 (m)', d));
    }
    if (O.lodMode === 'adaptive') {
      const f = el('input', { type: 'range', min: '20', max: '60', step: '5', value: String(O.targetFps), style: 'width:100%' });
      const fl = el('span', {}, ' ' + O.targetFps + ' fps');
      f.oninput = () => { O.targetFps = +f.value; scene.opts({ targetFps: O.targetFps }); fl.textContent = ' ' + O.targetFps + ' fps'; };
      optBox.append(olbl(el('span', {}, '목표 FPS', fl), f));
    }
    const capSel = el('select', { style: 'width:100%;font:11px monospace' });
    [[0, '무제한'], [50000, '5만'], [100000, '10만'], [200000, '20만'], [500000, '50만']].forEach(([v, l]) => capSel.append(el('option', { value: v }, l)));
    capSel.value = String(O.maxPoints);
    capSel.onchange = () => { O.maxPoints = +capSel.value; scene.opts({ maxPoints: O.maxPoints }); };
    optBox.append(olbl('최대 점수 (하드 상한)', capSel));
    const rc = el('input', { type: 'checkbox' });
    rc.checked = O.round;
    rc.onchange = () => { O.round = rc.checked; scene.opts({ round: O.round }); };
    optBox.append(el('label', { style: 'display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11px' }, rc, el('span', {}, '둥근 점 (끄면 사각·더 빠름)')));
  }
  renderOpt();
  // ── 🛠 3D 도구 — 그라운드(z=0) 클릭 → Publish Point / Nav Goal / Pose Estimate / 측정 ──
  const toolBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
  const toolTopics = { point: '/clicked_point', goal: '/goal_pose', pose: '/initialpose' };
  const FF = 'map';
  let activeTool = null, toolStage = null;
  const sph = (id, p, c) => ({ ns: 'tool', id, type: 2, action: 0, frame_id: FF, pose: { p, q: [0, 0, 0, 1] }, scale: [0.2, 0.2, 0.2], color: c, points: [], colors: [], text: '' });
  const arw = (id, p, yaw, c) => ({ ns: 'tool', id, type: 0, action: 0, frame_id: FF, pose: { p, q: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)] }, scale: [0.7, 0.1, 0.15], color: c, points: [], colors: [], text: '' });
  const showTool = (ms) => scene.setMarkersById('__tool__', ms);
  const clearTool = () => { activeTool = null; toolStage = null; scene.setPickHandler(null); scene.setInspect(null); showTool([]); renderTools(); };
  const inspectOut = el('div', { class: 'hint', style: 'margin-top:5px;font-family:monospace;line-height:1.6' });
  function onInspect(hit) {
    if (!hit) { inspectOut.textContent = '점 없음 — 클라우드 위를 클릭'; scene.setPin(null); return; }
    const w = hit.world, xyz = `${w[0].toFixed(3)}, ${w[1].toFixed(3)}, ${w[2].toFixed(3)}`;
    let valStr; if (hit.colorMode === 2) { const c = hit.value, b = c % 256, g = Math.floor(c / 256) % 256, r = Math.floor(c / 65536); valStr = `RGB ${r},${g},${b}`; } else valStr = `intensity ${(+hit.value).toFixed(2)}`;
    scene.setPin(w, `(${w[0].toFixed(2)}, ${w[1].toFixed(2)}, ${w[2].toFixed(2)})`);
    inspectOut.innerHTML = '';
    inspectOut.append(
      el('div', {}, 'XYZ: ', el('span', { style: 'color:var(--fg)' }, xyz + ' m')),
      el('div', {}, '값: ', el('span', { style: 'color:var(--cyan)' }, valStr)),
      el('div', {}, '가까운 프레임: ', el('span', { style: 'color:var(--green)' }, hit.frame ? `${hit.frame} (${hit.frameDist.toFixed(2)} m)` : '—')),
      el('button', { class: 'act', style: 'padding:1px 6px;margin-top:3px;font-size:11px', onclick: () => { if (navigator.clipboard) navigator.clipboard.writeText(xyz); toast('좌표 복사', 'ok'); } }, '좌표 복사'));
  }
  const pub = (topic, yaml) => post('/api/publish', { name: topic, msg: yaml }).then(() => toast('발행 → ' + topic, 'ok')).catch(() => toast('발행 실패', 'err'));
  function onToolPick(w) {
    if (activeTool === 'measure') {
      if (!toolStage) { toolStage = { p1: w }; showTool([sph(1, w, [0.9, 0.8, 0.3, 1])]); } else {
        const p1 = toolStage.p1, d = Math.hypot(w[0] - p1[0], w[1] - p1[1], w[2] - p1[2]);
        showTool([sph(1, p1, [0.9, 0.8, 0.3, 1]), sph(2, w, [0.9, 0.8, 0.3, 1]),
          { ns: 'tool', id: 3, type: 4, action: 0, frame_id: FF, pose: { p: [0, 0, 0], q: [0, 0, 0, 1] }, scale: [0.03, 0, 0], color: [0.9, 0.8, 0.3, 1], points: [p1, w], colors: [], text: '' },
          { ns: 'tool', id: 4, type: 9, action: 0, frame_id: FF, pose: { p: [(p1[0] + w[0]) / 2, (p1[1] + w[1]) / 2, 0.3], q: [0, 0, 0, 1] }, scale: [0, 0, 0.3], color: [1, 1, 1, 1], points: [], colors: [], text: d.toFixed(3) + ' m' }]);
        toast('거리: ' + d.toFixed(3) + ' m', 'info');
        toolStage = null;
      }
      return;
    }
    if (activeTool === 'point') { showTool([sph(1, w, [0.9, 0.42, 0.42, 1])]); pub(toolTopics.point, `{header: {frame_id: "${FF}"}, point: {x: ${w[0].toFixed(3)}, y: ${w[1].toFixed(3)}, z: 0.0}}`); clearTool(); return; }
    if (activeTool === 'goal' || activeTool === 'pose') {
      if (!toolStage) { toolStage = { p1: w }; showTool([sph(1, w, [0.44, 0.6, 0.95, 1])]); return; }
      const p1 = toolStage.p1, yaw = Math.atan2(w[1] - p1[1], w[0] - p1[0]), qz = Math.sin(yaw / 2), qw = Math.cos(yaw / 2);
      showTool([arw(1, p1, yaw, [0.44, 0.6, 0.95, 1])]);
      const posy = `position: {x: ${p1[0].toFixed(3)}, y: ${p1[1].toFixed(3)}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: ${qz.toFixed(4)}, w: ${qw.toFixed(4)}}`;
      pub(activeTool === 'goal' ? toolTopics.goal : toolTopics.pose, activeTool === 'goal'
        ? `{header: {frame_id: "${FF}"}, pose: {${posy}}}`
        : `{header: {frame_id: "${FF}"}, pose: {pose: {${posy}}, covariance: [0.25,0,0,0,0,0, 0,0.25,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0.0685]}}`);
      clearTool();
    }
  }
  function renderTools() {
    toolBox.innerHTML = '';
    toolBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:3px' }, '🛠 도구'));
    const tb = (label, tool) => el('button', { class: 'act', style: 'padding:2px 6px;margin:2px 3px 2px 0;font-size:11px' + (activeTool === tool ? ';border-color:var(--cyan);color:var(--cyan)' : ''), onclick: () => { if (activeTool === tool) { clearTool(); return; } activeTool = tool; toolStage = null; showTool([]); if (tool === 'inspect') { scene.setPickHandler(null); scene.setInspect(onInspect); } else { scene.setInspect(null); scene.setPickHandler(onToolPick); } renderTools(); } }, label);
    toolBox.append(tb('🔍 조회', 'inspect'), tb('📍 Point', 'point'), tb('🎯 Nav Goal', 'goal'), tb('📌 Pose', 'pose'), tb('📏 측정', 'measure'));
    toolBox.append(el('div', { class: 'hint', style: 'margin-top:3px' }, activeTool ? (activeTool === 'inspect' ? '점 클릭 → 좌표·값·프레임 조회' : activeTool === 'point' ? '그라운드 클릭 → 발행' : activeTool === 'measure' ? '두 점 클릭 → 거리(반복)' : '클릭=위치, 다시 클릭=방향') : '도구 선택 후 씬 클릭'));
    if (activeTool === 'inspect') toolBox.append(inspectOut);
  }
  renderTools();
  // ── 씬 우클릭(제자리) → 컨텍스트 메뉴: 여기로 Nav Goal / Point 발행 / 좌표 복사 ──
  let sceneMenu = null;
  const onDocDown = (ev) => { if (sceneMenu && !sceneMenu.contains(ev.target)) closeSceneMenu(); };
  function closeSceneMenu() { if (sceneMenu) { sceneMenu.remove(); sceneMenu = null; document.removeEventListener('mousedown', onDocDown, true); } }
  function showSceneMenu(w, e) {
    closeSceneMenu();
    if (!w) { toast('바닥(z=0) 평면을 벗어난 지점', 'warn'); return; }
    const item = (label, fn) => el('div', { style: 'padding:5px 12px;cursor:pointer;white-space:nowrap', onmouseenter: (ev) => { ev.currentTarget.style.background = 'var(--hover)'; }, onmouseleave: (ev) => { ev.currentTarget.style.background = ''; }, onclick: () => { fn(); closeSceneMenu(); } }, label);
    sceneMenu = el('div', { style: 'position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:3px 0;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.45)' },
      el('div', { class: 'hint', style: 'padding:3px 12px' }, `(${w[0].toFixed(2)}, ${w[1].toFixed(2)}) · ${FF}`),
      item('🎯 여기로 Nav Goal', () => { pub(toolTopics.goal, `{header: {frame_id: "${FF}"}, pose: {position: {x: ${w[0].toFixed(3)}, y: ${w[1].toFixed(3)}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}}}`); showTool([arw(1, w, 0, [0.44, 0.6, 0.95, 1])]); }),
      item('📍 여기로 Point 발행', () => { pub(toolTopics.point, `{header: {frame_id: "${FF}"}, point: {x: ${w[0].toFixed(3)}, y: ${w[1].toFixed(3)}, z: 0.0}}`); showTool([sph(1, w, [0.9, 0.42, 0.42, 1])]); }),
      item('📌 여기로 Pose Estimate', () => { pub(toolTopics.pose, `{header: {frame_id: "${FF}"}, pose: {pose: {position: {x: ${w[0].toFixed(3)}, y: ${w[1].toFixed(3)}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}}, covariance: [0.25,0,0,0,0,0, 0,0.25,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0, 0,0,0,0,0,0.0685]}}`); showTool([arw(1, w, 0, [0.44, 0.6, 0.95, 1])]); }),
      item('📋 좌표 복사', () => { if (navigator.clipboard) navigator.clipboard.writeText(`${w[0].toFixed(3)}, ${w[1].toFixed(3)}, 0.000`); toast('좌표 복사', 'ok'); }));
    sceneMenu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
    sceneMenu.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
    document.body.appendChild(sceneMenu);
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  }
  scene.setContextHandler(showSceneMenu);
  // ── 📷 카메라/프레임 — 고정 프레임(fixed frame) · 추종(follow) · 직교 투영 ──
  const camBox = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
  const CO = { fixedFrame: '', follow: '', ortho: false, camImg: '', camInf: '', camDist: 2 };
  function frameSelect(cur, first, cb) { const s = el('select', { style: 'width:100%;font:11px monospace' }); s.append(el('option', { value: '' }, first)); frameIds.forEach((f) => s.append(el('option', { value: f }, f))); s.value = cur; s.onchange = () => cb(s.value); return s; }
  function topicPick(list, cur, first, cb) { const s = el('select', { style: 'width:100%;font:11px monospace' }); s.append(el('option', { value: '' }, first)); list.forEach((t) => s.append(el('option', { value: t }, t))); s.value = cur; s.onchange = () => cb(s.value); return s; }
  function renderCam() {
    camBox.innerHTML = '';
    camBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '📷 카메라 / 프레임'));
    camBox.append(el('label', { class: 'hint', style: 'display:block;margin:4px 0 2px' }, '고정 프레임 (Fixed Frame)'), frameSelect(CO.fixedFrame, '기본 (루트)', (v) => { CO.fixedFrame = v; scene.opts({ fixedFrame: v || null }); }));
    camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, '추종 (Follow)'), frameSelect(CO.follow, '끔', (v) => { CO.follow = v; scene.opts({ follow: v || null }); if (!v) scene.view('iso'); }));
    const oc = el('input', { type: 'checkbox' });
    oc.checked = CO.ortho;
    oc.onchange = () => { CO.ortho = oc.checked; scene.opts({ ortho: oc.checked }); };
    camBox.append(el('label', { style: 'display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11px' }, oc, el('span', {}, '직교 투영 (Orthographic)')));
    // 카메라 이미지 3D 투영
    camBox.append(el('div', { class: 'hint', style: 'font-weight:600;margin:8px 0 2px' }, '🎥 이미지 투영'));
    camBox.append(el('label', { class: 'hint', style: 'display:block;margin:3px 0 2px' }, '이미지'), topicPick(imgTopics(), CO.camImg, '끔', (v) => { CO.camImg = v; subCamImg(v); }));
    camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, 'CameraInfo'), topicPick(camInfoTopics(), CO.camInf, '끔', (v) => { CO.camInf = v; subCamInf(v); }));
    const ds = el('input', { type: 'range', min: '0.3', max: '10', step: '0.1', value: String(CO.camDist), style: 'width:100%' });
    ds.oninput = () => { CO.camDist = +ds.value; scene.setCamOpts({ dist: CO.camDist }); };
    camBox.append(el('label', { class: 'hint', style: 'display:block;margin:5px 0 2px' }, '투영 거리 (m)'), ds);
  }
  renderCam();
  const timeBar = el('div', { class: 'hint', style: 'margin-top:4px' });
  const panel = el('div', { style: 'display:flex;gap:10px' },
    el('div', { style: 'width:210px;flex:none;border-right:1px solid var(--line);padding-right:8px;overflow:auto;max-height:78vh' }, el('div', { class: 'hint', style: 'font-weight:600;margin-bottom:2px' }, '🗂 Displays'), listBox, optBox, toolBox, camBox),
    el('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, topbar, stage, info, timeBar));
  openModal('🧊 3D 씬 (RViz 식)', panel);
  const M = document.querySelector('#modal .m');
  if (M) { M.style.width = 'min(1300px,96vw)'; }
  renderList();
  subTF(true);
  // 초기 디스플레이: it 지정 시 그 토픽, 아니면 첫 클라우드+첫 마커.
  if (it && markerTopics().includes(it.name)) addDisplay('marker', it.name);
  else if (it && cloudTopics().includes(it.name)) addDisplay('cloud', it.name);
  else { if (cloudTopics()[0]) addDisplay('cloud', cloudTopics()[0]); if (markerTopics()[0]) addDisplay('marker', markerTopics()[0]); }
  const statIv = setInterval(() => {
    if (!$('#modal').classList.contains('on')) { clearInterval(statIv); return; }
    const s = scene.getStats(), head = s.active ? `${s.fps} FPS` : '정지 (온디맨드)';   // 정지 씬은 렌더 스킵 → FPS 대신 상태 표시
    fpsOv.textContent = `${head} · ${s.drawn.toLocaleString()} / ${s.points.toLocaleString()} pts${s.lodMode !== 'off' && s.points ? ` · LOD ${Math.round(s.lodDist)}m` : ''}`;
    const wall = new Date().toLocaleTimeString(), sim = Clock.sim != null ? Clock.sim.toFixed(2) + 's' : '—';
    timeBar.textContent = `🕒 wall ${wall} · sim ${sim}${Clock.sim == null ? ' (no /clock)' : Clock.stale() ? ' (paused)' : ''}`;
  }, 500);
  setModalSub({ close: () => { clearInterval(statIv); closeSceneMenu(); for (const d of displays.values()) if (d.es) d.es.close(); if (tfES) tfES.close(); if (urdfES) urdfES.close(); if (camImgES) camImgES.close(); if (camInfES) camInfES.close(); scene.dispose(); } });
}
