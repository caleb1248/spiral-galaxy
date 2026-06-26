import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// test the midi generator and player
import { setNotes, playNote } from './music/midi-generator';

const TWO_PI = 2 * Math.PI;
const EPS = 1e-12;

const sliderDefs = [
  {
    key: 'A',
    label: 'Arm offset',
    min: 0.1,
    max: 2.0,
    step: 0.01,
    value: 0.8,
    digits: 3,
    category: 'Variables',
  },
  {
    key: 'B',
    label: 'Scale factor',
    min: 1.1,
    max: 10.0,
    step: 0.1,
    value: 2.0,
    digits: 3,
    category: 'Variables',
  },
  {
    key: 'N',
    label: 'Windings',
    min: 1,
    max: 50,
    step: 1,
    value: 16,
    digits: 0,
    category: 'Variables',
  },
  {
    key: 'C',
    label: 'Angular coverage',
    min: 0.1,
    max: 2.0,
    step: 0.01,
    value: 0.58,
    digits: 3,
    category: 'Variables',
  },
  {
    key: 'd',
    label: 'Noise std',
    min: 0.0,
    max: 0.5,
    step: 0.001,
    value: 0.075,
    digits: 4,
    category: 'Variables',
  },
  {
    key: 'C_t',
    label: 'Transition',
    min: 0.0,
    max: 1.0,
    step: 0.0001,
    value: 0.0573,
    digits: 4,
    category: 'Variables',
  },
  {
    key: 'p',
    label: 'Number of points',
    min: 20,
    max: 1000,
    step: 20,
    value: 200,
    digits: 0,
    category: 'Variables',
  },

  {
    key: 's_min',
    label: 'Minimum circle area',
    min: 0.25,
    max: 80,
    step: 0.25,
    value: 4.0,
    digits: 2,
    category: 'Display',
  },
  {
    key: 's_max',
    label: 'Maximum circle area',
    min: 1,
    max: 320,
    step: 1,
    value: 20.0,
    digits: 1,
    category: 'Display',
  },
  {
    key: 'R_d',
    label: 'Circle size',
    min: 0.01,
    max: 5.0,
    step: 0.01,
    value: 0.6,
    digits: 3,
    category: 'Display',
  },
  {
    key: 'speed',
    label: 'Speed (points / second)',
    min: 1,
    max: 64,
    step: 1,
    value: 16,
    digits: 0,
    category: 'Playback',
  },
  {
    key: 'seed',
    label: 'Random seed',
    min: 0,
    max: 1000,
    step: 1,
    value: 42,
    digits: 0,
    category: 'Variables',
  },
  {
    key: 'low',
    label: 'lower octave',
    min: 1,
    max: 4,
    step: 1,
    value: 2,
    digits: 0,
    category: 'Playback',
  },
  {
    key: 'hi',
    label: 'upper octave',
    min: 3,
    max: 7,
    step: 1,
    value: 5,
    digits: 0,
    category: 'Playback',
  },
  {
    key: 'doubleNote',
    label: 'Play both spirals',
    category: 'Playback',
    value: false,
    switch: true,
  },
  {
    key: 'contrary',
    label: 'Contrary motion',
    category: 'Playback',
    value: false,
    switch: true,
  },
];

const initialState = Object.fromEntries(sliderDefs.map((def) => [def.key, def.value]));
const state = { ...initialState };

let data = null;
let playing = false;
let highlightedIndex = 0;
let animationHandle = null;
let lastTimestamp = 0;
let playAccumulator = 0;
let renderPending = false;
let computeTimer = null;

const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');

let watch = null;

function bindWatchElements() {
  watch = {
    index: document.getElementById('watchIndex'),
    R: document.getElementById('watchR'),
    theta: document.getElementById('watchTheta'),
    step: document.getElementById('watchStep'),
    eta: document.getElementById('watchEta'),
  };
}

function formatValue(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  if (digits === 0) return Math.round(v).toString();
  return (+v).toFixed(digits);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rand) {
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = rand();
  while (v <= Number.EPSILON) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(TWO_PI * v);
}

function attenuation(index, p, C, Ct) {
  const turn = (index / p) * C;
  if (C <= Ct) return 1;
  if (turn < Ct) return 1;
  return 1 - (turn - Ct) / (C - Ct);
}

function radiusAtPhi(phi, A, B, N) {
  const z = B * Math.tan(phi / (2 * N));
  const denom = Math.log(z);
  if (!Number.isFinite(z) || !Number.isFinite(denom) || z <= 0 || Math.abs(denom) <= EPS) {
    return NaN;
  }
  const r = A / denom;
  return Number.isFinite(r) ? r : NaN;
}

function computeT(A, B, N, C, Ct, validPhis, validRhos) {
  const tipTurn = clamp(0, 1e-9, Math.max(C - 1e-9, 1e-9));
  const phiTip = TWO_PI * tipTurn;
  const rTip = radiusAtPhi(phiTip, A, B, N);

  if (Number.isFinite(rTip) && Math.abs(rTip) > EPS) {
    return Math.abs(rTip) * phiTip;
  }

  if (validPhis.length === 0) return 0;
  return Math.abs(validRhos[0]) * validPhis[0];
}

function rotatePoint(x, y, angle) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return [ca * x - sa * y, sa * x + ca * y];
}

function modTwoPi(theta) {
  return ((theta % TWO_PI) + TWO_PI) % TWO_PI;
}

function computeSpiral() {
  const A = +state.A;
  const B = +state.B;
  const N = +state.N;
  const C = +state.C;
  const d = +state.d;
  const p = Math.max(2, Math.round(+state.p));
  const Ct = +state.C_t;
  const seed = Math.round(+state.seed);
  const rand = mulberry32(seed);

  const raw = [];
  const validPhis = [];
  const validRhos = [];

  for (let k = 1; k <= p; k++) {
    const phi = (k / p) * TWO_PI * C;
    const rBase = radiusAtPhi(phi, A, B, N);
    if (!Number.isFinite(rBase)) continue;
    raw.push({ i: k, phi, rBase });
    validPhis.push(phi);
    validRhos.push(Math.abs(rBase));
  }

  if (raw.length < 2) {
    return {
      points: [],
      bounds: null,
      T: 0,
      error: 'Not enough valid points for these parameter settings.',
    };
  }

  const T = computeT(A, B, N, C, Ct, validPhis, validRhos);

  const pre = [];

  for (const item of raw) {
    const rho = Math.abs(item.rBase);
    const theta = item.phi - T / rho;
    const adj = attenuation(item.i, p, C, Ct);
    const Gg = gaussianRandom(rand) * d;
    const eta1 = Gg * adj;
    const eta2 = -eta1;
    const denom = A / item.rBase;
    const r1 = (A + eta1) / denom;
    const r2pre = (A + eta2) / denom;

    const x1 = r1 * Math.cos(theta);
    const y1 = r1 * Math.sin(theta);
    const x2pre = r2pre * Math.cos(theta);
    const y2pre = r2pre * Math.sin(theta);
    const xs = item.rBase * Math.cos(theta);
    const ys = item.rBase * Math.sin(theta);

    pre.push({
      i: item.i,
      phi: item.phi,
      theta,
      thetaMod: modTwoPi(theta),
      eta1,
      eta2,
      x1,
      y1,
      x2pre,
      y2pre,
      xs,
      ys,
    });
  }

  const tangentAngle = Math.atan2(pre[1].ys - pre[0].ys, pre[1].xs - pre[0].xs);
  const rot = -tangentAngle;

  const rotated = pre.map((pt) => {
    const [x1r, y1r] = rotatePoint(pt.x1, pt.y1, rot);
    const [x2pr, y2pr] = rotatePoint(pt.x2pre, pt.y2pre, rot);
    const [xsr, ysr] = rotatePoint(pt.xs, pt.ys, rot);
    return { ...pt, x1r, y1r, x2pr, y2pr, xsr, ysr };
  });

  const yShift = -rotated[0].ysr;
  const points = rotated.map((pt) => {
    const x1 = pt.x1r;
    const y1 = pt.y1r + yShift;
    const x2preShifted = pt.x2pr;
    const y2preShifted = pt.y2pr + yShift;
    const xs1 = pt.xsr;
    const ys1 = pt.ysr + yShift;

    // Current intended equations: central reflection for arm 2.
    const x2 = -x2preShifted;
    const y2 = -y2preShifted;
    const xs2 = -xs1;
    const ys2 = -ys1;

    const R1 = Math.hypot(x1, y1);
    const R2 = Math.hypot(x2, y2);
    return { ...pt, x1, y1, x2, y2, xs1, ys1, xs2, ys2, R1, R2 };
  });

  for (let j = 0; j < points.length; j++) {
    const a = points[j];
    const b = points[Math.min(j + 1, points.length - 1)];
    a.stepDist = j < points.length - 1 ? Math.hypot(a.x1 - b.x1, a.y1 - b.y1) : 0;
  }

  const bounds = computeBounds(points);
  return { points, bounds, T, error: null };
}

function computeBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    minX = Math.min(minX, pt.x1, pt.x2, pt.xs1, pt.xs2);
    maxX = Math.max(maxX, pt.x1, pt.x2, pt.xs1, pt.xs2);
    minY = Math.min(minY, pt.y1, pt.y2, pt.ys1, pt.ys2);
    maxY = Math.max(maxY, pt.y1, pt.y2, pt.ys1, pt.ys2);
  }

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const margin = 0.12 * span;
  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function scheduleRecompute() {
  if (computeTimer !== null) clearTimeout(computeTimer);
  computeTimer = setTimeout(() => {
    computeTimer = null;
    data = computeSpiral();
    highlightedIndex = clampHighlightIndex(highlightedIndex);

    computeNotes();
    updateStatusText();
    requestRender();
    updateWatchText();
  }, 0);
}

function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function resizeCanvasForDPR() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(500, Math.round(rect.width * dpr));
  const height = Math.max(500, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    requestRender();
  }
  return { width, height, dpr };
}

function makeTransform(bounds, width, height) {
  const pad = 28;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const scale = Math.min(plotW / worldW, plotH / worldH);
  const worldCx = (bounds.minX + bounds.maxX) / 2;
  const worldCy = (bounds.minY + bounds.maxY) / 2;
  const canvasCx = width / 2;
  const canvasCy = height / 2;

  return function toCanvas(x, y) {
    return [canvasCx + (x - worldCx) * scale, canvasCy - (y - worldCy) * scale];
  };
}

function render() {
  const { width, height } = resizeCanvasForDPR();
  ctx.clearRect(0, 0, width, height);

  drawBackground(width, height);

  if (!data || data.error || !data.bounds || data.points.length === 0) {
    drawCenteredMessage(data?.error || 'No data.', width, height);
    return;
  }

  const toCanvas = makeTransform(data.bounds, width, height);
  drawGrid(toCanvas, width, height);
  drawAxis(toCanvas);
  drawScaffold(toCanvas, data.points, 'rgba(160, 170, 185, 0.45)', 'rgba(230, 237, 243, 0.35)');
  drawPoints(toCanvas, data.points);
  drawHighlight(toCanvas, data.points[highlightedIndex]);

  if (state.doubleNote) {
    let highlightedArm2Index = state.contrary
      ? data.points.length - 1 - highlightedIndex
      : highlightedIndex;
    drawHighlight(toCanvas, data.points[highlightedArm2Index], 2);
  }
}

function drawBackground(width, height) {
  const grd = ctx.createRadialGradient(
    width * 0.5,
    height * 0.47,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.75,
  );
  grd.addColorStop(0, '#101827');
  grd.addColorStop(0.65, '#090d14');
  grd.addColorStop(1, '#05070b');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawCenteredMessage(message, width, height) {
  ctx.save();
  ctx.fillStyle = 'rgba(230, 237, 243, 0.92)';
  ctx.font = `${Math.max(14, width * 0.018)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, width / 2, height / 2);
  ctx.restore();
}

function drawGrid(toCanvas, width, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(130, 150, 170, 0.08)';
  ctx.lineWidth = 1;

  const lines = 10;
  for (let k = 1; k < lines; k++) {
    const x = (k / lines) * width;
    const y = (k / lines) * height;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxis(toCanvas) {
  const [x0a, y0a] = toCanvas(-1e6, 0);
  const [x0b, y0b] = toCanvas(1e6, 0);
  const [cx, cy] = toCanvas(0, 0);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(x0a, y0a);
  ctx.lineTo(x0b, y0b);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawScaffold(toCanvas, points, color1, color2) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);

  ctx.strokeStyle = color1;
  ctx.beginPath();
  points.forEach((pt, idx) => {
    const [x, y] = toCanvas(pt.xs1, pt.ys1);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = color2;
  ctx.beginPath();
  points.forEach((pt, idx) => {
    const [x, y] = toCanvas(pt.xs2, pt.ys2);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.restore();
}

function markerArea(R) {
  const sMin = Number(state.s_min);
  const sMax = Math.max(sMin, Number(state.s_max));
  const Rd = Math.max(1e-9, Number(state.R_d));
  return sMin + (sMax - sMin) * Math.exp(-R / Rd);
}

function drawCircle(cx, cy, radius, fill, stroke = null, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, radius * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPoints(toCanvas, points) {
  const colors = getComputedStyle(document.documentElement);
  const pos1 = colors.getPropertyValue('--positive').trim();
  const neg1 = colors.getPropertyValue('--negative').trim();
  const pos2 = colors.getPropertyValue('--arm2-positive').trim();
  const neg2 = colors.getPropertyValue('--arm2-negative').trim();

  for (const pt of points) {
    const [x1, y1] = toCanvas(pt.x1, pt.y1);
    const [x2, y2] = toCanvas(pt.x2, pt.y2);
    const r1 = Math.sqrt(markerArea(pt.R1) / Math.PI);
    const r2 = Math.sqrt(markerArea(pt.R2) / Math.PI);

    drawCircle(x1, y1, r1, pt.eta1 >= 0 ? pos1 : neg1, null, 1);
    drawCircle(x2, y2, r2, pt.eta2 >= 0 ? pos2 : neg2, null, 1);
  }
}

function drawHighlight(toCanvas, pt, arm = 1) {
  if (!pt) return;
  const [x, y] = toCanvas(arm === 1 ? pt.x1 : pt.x2, arm === 1 ? pt.y1 : pt.y2);
  const baseRadius = Math.sqrt(markerArea(arm === 1 ? pt.R1 : pt.R2) / Math.PI);
  const pulse = playing ? 1.0 + 0.25 * Math.sin(performance.now() / 120) : 1.0;
  const r = Math.max(baseRadius + 4, baseRadius * 2.0) * pulse;

  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  const label = `i=${pt.i}`;
  ctx.font = '14px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 14;
  const h = 24;
  const lx = x + r + 8;
  const ly = y - r - 4;
  roundedRect(ctx, lx, ly, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx + 7, ly + h / 2);
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function selectedMode() {
  return uiStateRef.current.highlightMode;
}

function acceptsPoint(pt) {
  const mode = selectedMode();
  if (mode === 'positive') return pt.eta1 >= 0;
  if (mode === 'negative') return pt.eta1 < 0;
  return true;
}

function advanceHighlight() {
  console.log('Advancing highlight from index', highlightedIndex);
  if (!data || !data.points || data.points.length === 0) return;
  const n = data.points.length;
  let next = (highlightedIndex + 1) % n;

  playNote(next, state.speed, state.doubleNote);

  if (selectedMode() === 'all') {
    highlightedIndex = next;
    return;
  }

  for (let scanned = 0; scanned < n; scanned++) {
    const pt = data.points[next];
    if (acceptsPoint(pt)) {
      highlightedIndex = next;
      return;
    }
    next = (next + 1) % n;
  }
  // If no point matches the mode, hold the current point.
}

function clampHighlightIndex(index) {
  if (!data || !data.points || data.points.length === 0) return 0;
  return clamp(index, 0, data.points.length - 1);
}

function ensureHighlightedPointMatchesMode() {
  if (!data || !data.points || data.points.length === 0) return;
  if (selectedMode() === 'all') return;
  if (acceptsPoint(data.points[highlightedIndex])) return;
  for (let k = 0; k < data.points.length; k++) {
    if (acceptsPoint(data.points[k])) {
      highlightedIndex = k;
      return;
    }
  }
}

function playLoop(timestamp) {
  if (!playing) return;
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = Math.min(0.2, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;

  const speed = Math.max(1, Number(state.speed));
  playAccumulator += dt * speed;

  let changed = false;
  while (playAccumulator >= 1) {
    advanceHighlight();
    playAccumulator -= 1;
    changed = true;
  }

  if (changed) updateWatch();
  requestRender();
  animationHandle = requestAnimationFrame(playLoop);
}

function setPlaying(value) {
  playing = !!value;

  if (playing) {
    ensureHighlightedPointMatchesMode();
    lastTimestamp = 0;
    playAccumulator = 0;
    animationHandle = requestAnimationFrame(playLoop);
  } else if (animationHandle !== null) {
    cancelAnimationFrame(animationHandle);
    animationHandle = null;
  }

  requestRender();
  updateWatchText();
}

function computeNotes() {
  // Compute notes

  const min = data.points[0].R1;
  const max = data.points.at(-1).R1;
  const diff = max - min;
  console.log(min, max, diff);

  const octaveDiff = Math.max(1, +state.hi - +state.low);

  // Calculate the highest note to determine scale
  let highestNote = data.points[0]?.R1 || 0;

  const mappedArm1 = Array(data.points.length);
  const mappedArm2 = Array(data.points.length);

  for (let i = 0; i < data.points.length; i++) {
    // not i = 1 because we still need to copy the points
    mappedArm1[i] = data.points[i].R1;
    mappedArm2[i] = data.points[i].R2;
    if (data.points[i].R1 > highestNote) highestNote = data.points[i].R1;
    if (data.points[i].R2 > highestNote) highestNote = data.points[i].R2;
  }

  for (let i = 0; i < mappedArm1.length; i++) {
    const norm1 = (mappedArm1[i] - min) / diff;
    const norm2 = (mappedArm2[i] - min) / diff;

    mappedArm1[i] = Math.round(norm1 * octaveDiff * 12) + Math.round(+state.low * 12);
    mappedArm2[i] = Math.round(norm2 * octaveDiff * 12) + Math.round(+state.low * 12);
  }

  if (state.contrary) mappedArm2.reverse();

  setNotes(mappedArm1, mappedArm2);
}

// React UI state plumbing (watch/status live in React; canvas draw live here)
const uiStateRef = { current: { highlightMode: 'all' } };
let setUiWatch = () => {};
let setUiStatus = () => {};
let setUiPlaying = () => {};

function updateWatchText() {
  const next = (() => {
    if (!data || !data.points || data.points.length === 0) {
      return { index: '—', R: '—', theta: '—', step: '—', eta: '—' };
    }
    const pt = data.points[highlightedIndex];
    return {
      index: String(pt.i),
      R: formatValue(pt.R1, 6),
      theta: formatValue(pt.thetaMod, 6),
      step: formatValue(pt.stepDist, 6),
      eta: formatValue(pt.eta1, 6),
    };
  })();
  setUiWatch(next);
}

function updateWatch() {
  if (!watch || !watch.index) return;

  if (!data || !data.points || data.points.length === 0) {
    watch.index.textContent = '—';
    watch.R.textContent = '—';
    watch.theta.textContent = '—';
    watch.step.textContent = '—';
    watch.eta.textContent = '—';
    return;
  }

  const pt = data.points[highlightedIndex];
  watch.index.textContent = String(pt.i);
  watch.R.textContent = formatValue(pt.R1, 6);
  watch.theta.textContent = formatValue(pt.thetaMod, 6);
  watch.step.textContent = formatValue(pt.stepDist, 6);
  watch.eta.textContent = formatValue(pt.eta1, 6);
}

function updateStatusText() {
  const next = (() => {
    if (!data) return 'Ready.';
    if (data.error) return data.error;
    const mode = selectedMode();
    return `Generated ${data.points.length} valid points per arm. Derived T = ${formatValue(data.T, 6)}. Highlight mode: ${mode}.`;
  })();
  setUiStatus(next);
}

function resetSimulation() {
  highlightedIndex = 0;
  ensureHighlightedPointMatchesMode();
  playAccumulator = 0;
  updateWatchText();
  updateStatusText();
  requestRender();
}

function setHighlightMode(nextMode) {
  uiStateRef.current.highlightMode = nextMode;
  ensureHighlightedPointMatchesMode();
  updateStatusText();
  updateWatchText();
  requestRender();
}

function setPlayingAndSync(value) {
  setPlaying(value);
  setUiPlaying(playing);
}

function SpiralControlsPanel() {
  const [sliders, setSliders] = useState(() => ({ ...state }));
  const [highlightMode, setHighlightModeState] = useState(uiStateRef.current.highlightMode);
  const [uiPlaying, setUiPlayingLocal] = useState(false);
  const [watchState, setWatchStateLocal] = useState({
    index: '—',
    R: '—',
    theta: '—',
    step: '—',
    eta: '—',
  });
  const [statusText, setStatusTextLocal] = useState('Ready.');

  useEffect(() => {
    bindWatchElements();
    setUiWatch = setWatchStateLocal;
    setUiStatus = setStatusTextLocal;
    setUiPlaying = setUiPlayingLocal;

    updateWatchText();
    updateStatusText();
    setUiPlayingLocal(playing);
  }, []);

  const controlsByCategory = sliderDefs.reduce((acc, def) => {
    if (!acc[def.category]) acc[def.category] = [];
    acc[def.category].push(def);
    return acc;
  }, {});

  const sliderControls = Object.entries(controlsByCategory).map(([category, defs]) => (
    <details className="control-group" key={category} open>
      <summary>{category}</summary>
      <div className="control-group-body">
        {defs.map((def) => {
          const v = sliders[def.key];
          const isSwitch = !!def.switch;
          return (
            <div className={isSwitch ? 'control control-switch' : 'control'} key={def.key}>
              <label htmlFor={`slider-${def.key}`}>{def.label}</label>
              {!isSwitch && <span className="value">{formatValue(v, def.digits)}</span>}
              {isSwitch ? (
                <label className="switch" htmlFor={`slider-${def.key}`}>
                  <input
                    type="checkbox"
                    id={`slider-${def.key}`}
                    checked={!!v}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setSliders((prev) => ({ ...prev, [def.key]: next }));
                      state[def.key] = next;

                      if (def.key === 'doubleNote') globalThis.doubleNote = next;

                      scheduleRecompute();
                    }}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </label>
              ) : (
                <input
                  type="range"
                  id={`slider-${def.key}`}
                  min={String(def.min)}
                  max={String(def.max)}
                  step={String(def.step)}
                  value={String(v)}
                  onInput={(e) => {
                    const next = +e.target.value;
                    setSliders((prev) => ({ ...prev, [def.key]: next }));
                    state[def.key] = next;
                    scheduleRecompute();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </details>
  ));

  return (
    <>
      <h2 className="group-title">Spiral parameters</h2>
      <div>{sliderControls}</div>

      <div className="button-row">
        <button
          type="button"
          onClick={() => {
            setPlayingAndSync(!playing);
          }}
        >
          {uiPlaying ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => {
            resetSimulation();
          }}
        >
          Reset
        </button>
      </div>

      <fieldset className="radio-card">
        <legend>Highlight mode</legend>

        <label>
          <input
            type="radio"
            name="highlightMode"
            value="all"
            checked={highlightMode === 'all'}
            onChange={() => {
              setHighlightModeState('all');
              setHighlightMode('all');
            }}
          />
          Sequential: every i
        </label>

        <label>
          <input
            type="radio"
            name="highlightMode"
            value="positive"
            checked={highlightMode === 'positive'}
            onChange={() => {
              setHighlightModeState('positive');
              setHighlightMode('positive');
            }}
          />
          Only positive ηᵢ = Ggᵢ·a
          <sub>dj,i</sub>
        </label>

        <label>
          <input
            type="radio"
            name="highlightMode"
            value="negative"
            checked={highlightMode === 'negative'}
            onChange={() => {
              setHighlightModeState('negative');
              setHighlightMode('negative');
            }}
          />
          Only negative ηᵢ = Ggᵢ·a
          <sub>dj,i</sub>
        </label>
      </fieldset>

      <section className="watch" aria-label="Parameter watch">
        <h2>Parameter watch</h2>

        <div className="metric">
          <span className="name">Current index i</span>
          <span className="number" id="watchIndex">
            {watchState.index}
          </span>
        </div>

        <div className="metric">
          <span className="name">Distance from center Rᵢ</span>
          <span className="number" id="watchR">
            {watchState.R}
          </span>
        </div>

        <div className="metric">
          <span className="name">θᵢ mod 2π</span>
          <span className="number" id="watchTheta">
            {watchState.theta}
          </span>
        </div>

        <div className="metric">
          <span className="name">||Pᵢ − Pᵢ₊₁||</span>
          <span className="number" id="watchStep">
            {watchState.step}
          </span>
        </div>

        <div className="metric">
          <span className="name">
            ηᵢ = Ggᵢ·a<sub>dj,i</sub>
          </span>
          <span className="number" id="watchEta">
            {watchState.eta}
          </span>
        </div>
      </section>

      <div className="status" id="status">
        {statusText}
      </div>
    </>
  );
}

window.addEventListener('resize', () => requestRender());

const controlsPanel = document.querySelector('section.panel.controls');
if (!controlsPanel) throw new Error('Missing controls panel section: section.panel.controls');
controlsPanel.replaceChildren();
const root = createRoot(controlsPanel);
root.render(<SpiralControlsPanel />);

data = computeSpiral();
computeNotes();
ensureHighlightedPointMatchesMode();
updateWatchText();
updateStatusText();
requestRender();
