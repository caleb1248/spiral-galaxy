import "./style.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { extraSliderDefs, SHOWN_SLIDERS, state } from "./state";
import { setNotes, playNote, indicies, exportPdf } from "./music";
import { midiNote, scale, waitForImageToLoad } from "./utils";
import starfieldImageUrl from "./assets/starfield.png";
import type { SpiralData, Point, Bounds, ToCanvasFn, UiWatch } from "./types";
import {
  attenuation,
  computeT,
  formatValue,
  gaussianRandom,
  markerArea,
  modTwoPi,
  mulberry32,
  notePerSecond,
  radiusAtPhi,
  rotatePoint,
} from "./math";

const starfieldImage = new Image();
// starfieldImage.style.display = 'none';
// document.body.appendChild(starfieldImage);
const minStarfieldDimension = Math.min(starfieldImage.width, starfieldImage.height);

await waitForImageToLoad(starfieldImage, starfieldImageUrl);

const TWO_PI = 2 * Math.PI;

let data: SpiralData | null = null;
let playing = false;
let highlightedIndex = 0;
let animationHandle: number | null = null;
let lastTimestamp = 0;
let playAccumulator = 0;
let renderPending = false;
let computeTimer: number | null = null;

const canvas = document.getElementById("plot") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let watch: {
  index: HTMLElement;
  R: HTMLElement;
  theta: HTMLElement;
  step: HTMLElement;
  eta: HTMLElement;
} | null = null;

function getAvailablePoint(index: number): Point {
  if (!data?.points)
    throw new Error(
      "Data points are not available. Make sure that data is available before calling this function.",
    );

  return data.points[indicies[0][index] || indicies[1][index] || 0];
}

function bindWatchElements() {
  watch = {
    index: document.getElementById("watchIndex")!,
    R: document.getElementById("watchR")!,
    theta: document.getElementById("watchTheta")!,
    step: document.getElementById("watchStep")!,
    eta: document.getElementById("watchEta")!,
  };
}

function computeSpiral(): SpiralData {
  // Randomize the random seed each time
  state.seed = Math.floor(
    scale(0, 1, 0, extraSliderDefs.find((def) => def.key === "seed")!.max, Math.random()),
  );

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
      error: "Not enough valid points for these parameter settings.",
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
    return { ...pt, x1, y1, x2, y2, xs1, ys1, xs2, ys2, R1, R2 } as Point;
  });

  for (let j = 0; j < points.length; j++) {
    const a = points[j];
    const b = points[Math.min(j + 1, points.length - 1)];
    a.stepDist = j < points.length - 1 ? Math.hypot(a.x1 - b.x1, a.y1 - b.y1) : 0;
  }

  const bounds = computeBounds(points);
  return { points, bounds, T, error: null };
}

function computeBounds(points: Point[]): Bounds | null {
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function scheduleRecompute() {
  if (!data?.points[indicies[0][highlightedIndex] || indicies[1][highlightedIndex] || -1])
    highlightedIndex = 0;
  if (computeTimer !== null) clearTimeout(computeTimer);
  computeTimer = setTimeout(() => {
    computeTimer = null;
    data = computeSpiral();
    highlightedIndex = clampHighlightIndex(highlightedIndex);

    computeNotes();
    computeIndicies();
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

function makeTransform(bounds: Bounds, width: number, height: number): ToCanvasFn {
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
    drawCenteredMessage(data?.error || "No data.", width, height);
    return;
  }

  const toCanvas = makeTransform(data.bounds, width, height);
  drawBackground(width, height);
  // drawGrid(toCanvas, width, height);
  // drawAxis(toCanvas);
  drawScaffold(toCanvas, data.points, "rgba(160, 170, 185, 0.45)", "rgba(230, 237, 243, 0.35)");
  drawPoints(toCanvas, data.points);

  const pt1Index = indicies[0][highlightedIndex];
  const pt2Index = indicies[1][highlightedIndex];
  if (typeof pt1Index === "number") drawHighlight(toCanvas, data.points[pt1Index]);

  if (typeof pt2Index === "number") drawHighlight(toCanvas, data.points[pt2Index], 2);
}

function drawBackground(width: number, height: number) {
  console.log("draw background");
  // const grd = ctx.createRadialGradient(
  //   width * 0.5,
  //   height * 0.47,
  //   0,
  //   width * 0.5,
  //   height * 0.5,
  //   Math.max(width, height) * 0.75,
  // );
  // grd.addColorStop(0, '#101827');
  // grd.addColorStop(0.65, '#090d14');
  // grd.addColorStop(1, '#05070b');
  // ctx.fillStyle = grd;
  // ctx.fillRect(0, 0, width, height);
  console.log(starfieldImage.width, starfieldImage.height, minStarfieldDimension);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(
    starfieldImage,
    0,
    0,
    starfieldImage.width * (width / minStarfieldDimension),
    starfieldImage.height * (height / minStarfieldDimension),
  );
}

// globalThis.drawBackground = drawBackground;

function drawCenteredMessage(message: string, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "rgba(230, 237, 243, 0.92)";
  ctx.font = `${Math.max(14, width * 0.018)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, width / 2, height / 2);
  ctx.restore();
}

// @ts-ignore not used right now
function drawGrid(_toCanvas: ToCanvasFn, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(130, 150, 170, 0.08)";
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

// @ts-ignore not used right now
function drawAxis(toCanvas: (x: number, y: number) => [number, number]) {
  const [x0a, y0a] = toCanvas(-1e6, 0);
  const [x0b, y0b] = toCanvas(1e6, 0);
  const [cx, cy] = toCanvas(0, 0);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(x0a, y0a);
  ctx.lineTo(x0b, y0b);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawScaffold(toCanvas: ToCanvasFn, points: Point[], color1: string, color2: string) {
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

function drawCircle(
  cx: number,
  cy: number,
  radius: number,
  fill: string = "white",
  stroke: string | null = null,
  alpha: number = 1,
) {
  radius *= 3;
  // // Render a 4-point star (a rotated square / diamond with extended tips).
  // // Points are computed from `radius` so existing callers can keep using it.
  // const outer = Math.max(0, radius);
  // const inner = outer * 0.5;

  // const points: Array<[number, number]> = [
  //   [cx, cy - outer],
  //   [cx + outer, cy],
  //   [cx, cy + outer],
  //   [cx - outer, cy],
  //   [cx, cy - inner],
  // ];

  // ctx.save();
  // ctx.globalAlpha = alpha;
  // ctx.beginPath();
  // ctx.moveTo(points[0][0], points[0][1]);
  // for (let i = 1; i < points.length; i++) {
  //   ctx.lineTo(points[i][0], points[i][1]);
  // }
  // ctx.closePath();
  // ctx.fillStyle = fill;
  // ctx.fill();
  // if (stroke) {
  //   ctx.strokeStyle = stroke;
  //   ctx.lineWidth = Math.max(1, outer * 0.25);
  //   ctx.stroke();
  // }
  // ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;

  const r = radius / Math.SQRT2;

  ctx.beginPath();

  ctx.moveTo(cx, cy - radius);

  // top → right
  ctx.arc(cx + r, cy - r, r, Math.PI, Math.PI / 2, true);

  // right → bottom
  ctx.arc(cx + r, cy + r, r, -Math.PI / 2, Math.PI, true);

  // bottom → left
  ctx.arc(cx - r, cy + r, r, 0, -Math.PI / 2, true);

  // left → top
  ctx.arc(cx - r, cy - r, r, Math.PI / 2, 0, true);

  ctx.closePath();

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }

  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  ctx.restore();
}

function drawPoints(toCanvas: ToCanvasFn, points: Point[]) {
  for (const pt of points) {
    const [x1, y1] = toCanvas(pt.x1, pt.y1);
    const [x2, y2] = toCanvas(pt.x2, pt.y2);
    const r1 = Math.sqrt(markerArea(pt.R1, state) / Math.PI);
    const r2 = Math.sqrt(markerArea(pt.R2, state) / Math.PI);

    drawCircle(x1, y1, r1);
    drawCircle(x2, y2, r2);
  }
}

function drawHighlight(toCanvas: ToCanvasFn, pt: Point | null, arm = 1) {
  if (!pt) return;
  const [x, y] = toCanvas(arm === 1 ? pt.x1 : pt.x2, arm === 1 ? pt.y1 : pt.y2);
  const baseRadius = Math.sqrt(markerArea(arm === 1 ? pt.R1 : pt.R2, state) / Math.PI);
  const pulse = playing ? 1.0 + 0.25 * Math.sin(performance.now() / 120) : 1.0;
  const r = Math.max(baseRadius + 4, baseRadius * 2.0) * pulse;

  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = 18;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1;
  const label = `i=${pt.i}`;
  ctx.font = "14px system-ui, sans-serif";
  const w = ctx.measureText(label).width + 14;
  const h = 24;
  const lx = x + r + 8;
  const ly = y - r - 4;
  roundedRect(ctx, lx, ly, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, lx + 7, ly + h / 2);
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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

function acceptsPoint(pt: Point) {
  const mode = selectedMode();
  if (mode === "positive") return pt.eta1 >= 0;
  if (mode === "negative") return pt.eta1 < 0;
  return true;
}

function advanceHighlight() {
  if (!data || !data.points || data.points.length === 0) return;
  const n = indicies[0].length;
  let next = highlightedIndex + 1;
  if (next >= n) {
    end();
    highlightedIndex = 0;
    return;
  }

  if (next >= indicies[0].length) next = 0;

  playNote(next, notePerSecond(state.tempo, state.npb));

  if (selectedMode() === "all") {
    highlightedIndex = next;
    return;
  }

  for (let scanned = 0; scanned < n; scanned++) {
    if (acceptsPoint(getAvailablePoint(next))) {
      highlightedIndex = next;
      return;
    }
    next = (next + 1) % n;
  }
  // If no point matches the mode, hold the current point.
}

function clampHighlightIndex(index: number) {
  if (!data || !data.points || data.points.length === 0) return 0;

  const result = clamp(index, 0, indicies[0].length - 1);
  // if (result !== index) console.warn('clamped!');
  return result;
}

function ensureHighlightedPointMatchesMode() {
  if (!data || !data.points || data.points.length === 0) return;
  if (selectedMode() === "all") return;
  if (acceptsPoint(getAvailablePoint(highlightedIndex))) return;
  for (let k = 0; k < indicies[0].length; k++) {
    if (indicies[0][k] && acceptsPoint(data.points[indicies[0][k]!])) {
      highlightedIndex = k;
      return;
    }
  }
}

function playLoop(timestamp: number) {
  if (!playing) return;
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = Math.min(0.2, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;

  const speed = Math.max(1, notePerSecond(+state.tempo, state.npb));
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

function play() {
  if (playing) return;
  playing = true;

  ensureHighlightedPointMatchesMode();
  lastTimestamp = 0;
  playAccumulator = 0;
  animationHandle = requestAnimationFrame(playLoop);

  requestRender();
  updateWatchText();
}

function end() {
  if (!animationHandle) return;
  cancelAnimationFrame(animationHandle);
  animationHandle = null;
  playing = false;
}

function computeNotes() {
  const mappedArm1 = data!.points.map((pt) => pt.R1);
  const mappedArm2 = data!.points.map((pt) => pt.R2);

  const maxArm1 = Math.max(...mappedArm1);
  const maxArm2 = Math.max(...mappedArm2);

  const minArm1 = Math.min(...mappedArm1);
  const minArm2 = Math.min(...mappedArm2);

  const targetArm1Min = midiNote(0, 4);
  const targetArm1Max = midiNote(0, 7);

  const targetArm2Min = midiNote(10, 0);
  const targetArm2Max = midiNote(10, 3);

  const scaleArm1 = scale(minArm1, maxArm1, targetArm1Min, targetArm1Max, mappedArm1);
  const scaleArm2 = scale(minArm2, maxArm2, targetArm2Min, targetArm2Max, mappedArm2);

  setNotes(scaleArm1, scaleArm2);
}

// React UI state plumbing (watch/status live in React; canvas draw live here)
const uiStateRef = { current: { highlightMode: "all" } };

let setUiWatch: (watch: UiWatch) => void = () => {};

function updateWatchText() {
  const next: UiWatch = (() => {
    if (!data || !data.points || data.points.length === 0) {
      return { index: "—", R: "—", theta: "—", step: "—", eta: "—" };
    }

    // console.log(indicies[0][highlightedIndex], highlightedIndex, data.points.length);

    // console.log(indicies[0]);
    const pt = getAvailablePoint(highlightedIndex); // data is not null here
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
    watch.index.textContent = "—";
    watch.R.textContent = "—";
    watch.theta.textContent = "—";
    watch.step.textContent = "—";
    watch.eta.textContent = "—";
    return;
  }

  const pt = getAvailablePoint(highlightedIndex);
  watch.index.textContent = String(pt.i);
  watch.R.textContent = formatValue(pt.R1, 6);
  watch.theta.textContent = formatValue(pt.thetaMod, 6);
  watch.step.textContent = formatValue(pt.stepDist, 6);
  watch.eta.textContent = formatValue(pt.eta1, 6);
}

// function resetSimulation() {
//   highlightedIndex = 0;
//   ensureHighlightedPointMatchesMode();
//   playAccumulator = 0;
//   updateWatchText();
//   updateStatusText();
//   requestRender();
// }

function setHighlightMode(nextMode: string) {
  uiStateRef.current.highlightMode = nextMode;
  ensureHighlightedPointMatchesMode();
  updateWatchText();
  requestRender();
}

function sequence(length: number, reverse = false) {
  return Array.from({ length }, reverse ? (_, i) => length - 1 - i : (_, i) => i);
}

function computeIndicies() {
  if (!data || !data.points) return;
  indicies[0] = [
    ...(sequence(data?.points.length) as number[]),
    ...(Array.from({ length: data?.points.length }).fill(null) as null[]),
    ...(sequence(data?.points.length) as number[]),
  ];

  console.log("done:", indicies[0]);

  indicies[1] = [
    ...(Array.from({ length: data?.points.length }).fill(null) as null[]),
    ...(sequence(data?.points.length) as number[]),
    ...(sequence(data?.points.length) as number[]),
  ];
}

function SpiralControlsPanel() {
  const [sliders, setSliders] = useState(() => ({ ...state }));
  const [highlightMode, setHighlightModeState] = useState(uiStateRef.current.highlightMode);
  const [watchState, setWatchStateLocal] = useState({
    index: "—",
    R: "—",
    theta: "—",
    step: "—",
    eta: "—",
  });

  useEffect(() => {
    bindWatchElements();
    setUiWatch = setWatchStateLocal;

    updateWatchText();
  }, []);

  const sliderControls = extraSliderDefs.map((def) => {
    const key = def.key as keyof typeof sliders;
    if (!SHOWN_SLIDERS.includes(key)) return null;
    const v = sliders[key];
    return (
      <div className="control" key={def.key}>
        <div className="control-label">
          <label htmlFor={`slider-${def.key}`}>{def.label}</label>
          <span className="value">{def.format ? def.format(state[key]) : state[key]}</span>
        </div>

        <input
          type="range"
          id={`slider-${def.key}`}
          min={String(def.min)}
          max={String(def.max)}
          step={String(def.step)}
          value={String(v)}
          onInput={(e) => {
            const next = +e.currentTarget.value;
            setSliders((prev) => ({ ...prev, [def.key]: next }));
            state[def.key as keyof typeof state] = next;
            scheduleRecompute();
          }}
        />
      </div>
    );
  });

  return (
    <>
      <h2 className="group-title">Variables</h2>
      <div>{sliderControls}</div>

      <div className="button-row">
        <button type="button" onClick={() => play()}>
          Listen to your galaxy
        </button>
        <button type="button" className="secondary" onClick={() => exportPdf()}>
          Export score
        </button>
      </div>

      <fieldset className="radio-card">
        <legend>Highlight mode</legend>

        <label>
          <input
            type="radio"
            name="highlightMode"
            value="all"
            checked={highlightMode === "all"}
            onChange={() => {
              setHighlightModeState("all");
              setHighlightMode("all");
            }}
          />
          Sequential: every i
        </label>

        <label>
          <input
            type="radio"
            name="highlightMode"
            value="positive"
            checked={highlightMode === "positive"}
            onChange={() => {
              setHighlightModeState("positive");
              setHighlightMode("positive");
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
            checked={highlightMode === "negative"}
            onChange={() => {
              setHighlightModeState("negative");
              setHighlightMode("negative");
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

      {/* <div className="status" id="status">
        {statusText}
      </div> */}
    </>
  );
}

window.addEventListener("resize", () => requestRender());

const controlsPanel = document.querySelector("section.panel.controls");
if (!controlsPanel) throw new Error("Missing controls panel section: section.panel.controls");
controlsPanel.replaceChildren();
const root = createRoot(controlsPanel);
root.render(<SpiralControlsPanel />);

data = computeSpiral();
computeNotes();
console.log("computing indicies");
computeIndicies();
ensureHighlightedPointMatchesMode();
updateWatchText();
requestRender();
