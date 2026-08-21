import "./style.css";
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { extraSliderDefs, state } from "./lib/state";
import { setNotes, playNote, indicies } from "./lib/music";
import { mountControls, uiStateRef, updateWatch as updateUiWatch } from "./lib/ui";
import { /*midiNote,*/ scale, waitForImageToLoad } from "./lib/utils";
import starfieldImageUrl from "./assets/starfield.png";
import type { SpiralData, Point, Bounds, ToCanvasFn, UiWatch } from "./lib/types";
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
} from "./lib/math";

const starfieldImage = new Image();
// starfieldImage.style.display = 'none';
// document.body.appendChild(starfieldImage);
await waitForImageToLoad(starfieldImage, starfieldImageUrl);
const minStarfieldDimension = Math.min(starfieldImage.width, starfieldImage.height);

const TWO_PI = 2 * Math.PI;

let data: SpiralData | null = null;
// Bumped whenever the spiral is recomputed, so the static dust knows to re-scatter.
let spiralVersion = 0;
let playing = false;
let highlightedIndex = 0;
let animationHandle: number | null = null;
let lastTimestamp = 0;
let playAccumulator = 0;
let renderPending = false;
let computeTimer: number | null = null;

const canvas = document.getElementById("plot") as HTMLCanvasElement;
const pixiApp = new Application();
await pixiApp.init({ canvas, antialias: true, autoStart: false, backgroundAlpha: 0 });
const plotStage = new Container();
pixiApp.stage.addChild(plotStage);
// Particles live in their own layer so the per-frame plot rebuild never destroys them.
const particleLayer = new Container();
pixiApp.stage.addChild(particleLayer);
const starfieldTexture = Texture.from(starfieldImage);

function getAvailablePoint(index: number): Point {
  if (!data?.points)
    throw new Error(
      "Data points are not available. Make sure that data is available before calling this function.",
    );

  return data.points[indicies[0][index] || indicies[1][index] || 0];
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
    spiralVersion++;
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
  const width = Math.max(500, Math.round(rect.width));
  const height = Math.max(500, Math.round(rect.height));
  if (pixiApp.screen.width !== width || pixiApp.screen.height !== height) {
    pixiApp.renderer.resize(width, height);
    requestRender();
  }
  return { width, height };
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
  plotStage.removeChildren().forEach((child) => child.destroy());
  drawBackground(width, height);

  if (!data || data.error || !data.bounds || data.points.length === 0) {
    starAnchors = [];
    anchorWeights = [];
    drawCenteredMessage(data?.error || "No data.", width, height);
    pixiApp.renderer.render({ container: pixiApp.stage });
    return;
  }

  const toCanvas = makeTransform(data.bounds, width, height);
  drawScaffold(toCanvas, data.points, "rgba(160, 170, 185, 0.45)", "rgba(230, 237, 243, 0.35)");
  drawPoints(toCanvas, data.points);
  layoutParticlesIfNeeded(`${spiralVersion}:${width}x${height}`);

  const pt1Index = indicies[0][highlightedIndex];
  const pt2Index = indicies[1][highlightedIndex];
  if (typeof pt1Index === "number") drawHighlight(toCanvas, data.points[pt1Index]);

  if (typeof pt2Index === "number") drawHighlight(toCanvas, data.points[pt2Index], 2);
  pixiApp.renderer.render({ container: pixiApp.stage });
}

function drawBackground(width: number, height: number) {
  const background = new Sprite(starfieldTexture);
  background.width = starfieldImage.width * (width / minStarfieldDimension);
  background.height = starfieldImage.height * (height / minStarfieldDimension);
  plotStage.addChild(background);
}

// globalThis.drawBackground = drawBackground;

function drawCenteredMessage(message: string, width: number, height: number) {
  const text = new Text({
    text: message,
    style: new TextStyle({ fill: 0xe6edf3, fontSize: Math.max(14, width * 0.018) }),
  });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2);
  plotStage.addChild(text);
}

function drawScaffold(toCanvas: ToCanvasFn, points: Point[], _color1: string, _color2: string) {
  if (points.length === 0) return;
  const drawLine = (xKey: "xs1" | "xs2", yKey: "ys1" | "ys2", color: number, alpha: number) => {
    const line = new Graphics();
    line.setStrokeStyle({ width: 2, color, alpha });
    line.moveTo(...toCanvas(points[0][xKey], points[0][yKey]));
    for (let idx = 1; idx < points.length; idx++)
      line.lineTo(...toCanvas(points[idx][xKey], points[idx][yKey]));
    plotStage.addChild(line);
  };
  drawLine("xs1", "ys1", 0xa0aab9, 0.45);
  drawLine("xs2", "ys2", 0xe6edf3, 0.35);
  /*
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

  ctx.restore(); */
}

function drawStar(
  circle: Graphics,
  cx: number,
  cy: number,
  radius: number,
  fill: string = "white",
  stroke: string | null = null,
  alpha: number = 1,
) {
  radius *= 3;
  const cornerRadius = radius / Math.SQRT2;

  // Build the four-pointed star from four circular arcs rather than straight edges.
  circle.moveTo(cx, cy - radius);
  circle.arc(cx + cornerRadius, cy - cornerRadius, cornerRadius, Math.PI, Math.PI / 2, true);
  circle.arc(cx + cornerRadius, cy + cornerRadius, cornerRadius, -Math.PI / 2, Math.PI, true);
  circle.arc(cx - cornerRadius, cy + cornerRadius, cornerRadius, 0, -Math.PI / 2, true);
  circle.arc(cx - cornerRadius, cy - cornerRadius, cornerRadius, Math.PI / 2, 0, true);
  circle.closePath();
  circle.fill({ color: fill, alpha });
  if (stroke) circle.stroke({ color: stroke, width: 1, alpha });
}

function drawPoints(toCanvas: ToCanvasFn, points: Point[]) {
  // All stars share one Graphics: hundreds of separate ones would be hundreds of draw calls.
  const stars = new Graphics();
  starAnchors = [];

  for (const pt of points) {
    const [x1, y1] = toCanvas(pt.x1, pt.y1);
    const [x2, y2] = toCanvas(pt.x2, pt.y2);
    const r1 = Math.sqrt(markerArea(pt.R1, state) / Math.PI);
    const r2 = Math.sqrt(markerArea(pt.R2, state) / Math.PI);

    drawStar(stars, x1, y1, r1);
    drawStar(stars, x2, y2, r2);
    // drawStar scales its radius by 3, so anchors track the on-screen size.
    starAnchors.push({ x: x1, y: y1, r: r1 * 3 }, { x: x2, y: y2, r: r2 * 3 });
  }

  anchorWeights = [];
  let running = 0;
  for (const anchor of starAnchors) {
    running += anchor.r * anchor.r;
    anchorWeights.push(running);
  }

  plotStage.addChild(stars);
}

function drawHighlight(toCanvas: ToCanvasFn, pt: Point | null, arm = 1) {
  if (!pt) return;
  const [x, y] = toCanvas(arm === 1 ? pt.x1 : pt.x2, arm === 1 ? pt.y1 : pt.y2);
  const baseRadius = Math.sqrt(markerArea(arm === 1 ? pt.R1 : pt.R2, state) / Math.PI);
  const pulse = playing ? 1.0 + 0.25 * Math.sin(performance.now() / 120) : 1.0;
  const r = Math.max(baseRadius + 4, baseRadius * 2.0) * pulse;

  const label = `i=${pt.i}`;
  const highlight = new Graphics();
  highlight
    .circle(x, y, r)
    .fill({ color: 0xffffff, alpha: 0.22 })
    .stroke({ color: 0xffffff, width: 3, alpha: 0.95 });
  plotStage.addChild(highlight);
  const text = new Text({ text: label, style: new TextStyle({ fill: 0xffffff, fontSize: 14 }) });
  const w = text.width + 14;
  const h = 24;
  const lx = x + r + 8;
  const ly = y - r - 4;
  const box = new Graphics();
  box
    .roundRect(lx, ly, w, h, 8)
    .fill({ color: 0x000000, alpha: 0.78 })
    .stroke({ color: 0xffffff, width: 1, alpha: 0.75 });
  text.position.set(lx + 7, ly + 4);
  plotStage.addChild(box, text);
}

type StarAnchor = { x: number; y: number; r: number };
type Particle = { sprite: Sprite; halo: Sprite };

const PARTICLE_COUNT = 2000;
// Warm dust: each particle gets a tint somewhere between pale gold and amber.
const PARTICLE_TINTS = [0xfff6d0, 0xffe9a8, 0xffd980, 0xffc85c, 0xfff0bb];
let starAnchors: StarAnchor[] = [];
// Cumulative r² weights, so a star's share of the dust grows with its radius.
let anchorWeights: number[] = [];
let particles: Particle[] = [];
// The dust is static, so it is only re-scattered when the geometry it sits on changes.
let particleLayoutKey = "";

function pickAnchor(): number {
  const total = anchorWeights[anchorWeights.length - 1];
  const target = Math.random() * total;
  let lo = 0;
  let hi = anchorWeights.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchorWeights[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Concentric fills approximate a radial falloff; `rings` and `coreAlpha` set how tight it is.
function makeParticleTexture(rings: number, ringAlpha: number, core: number): Texture {
  const radius = PARTICLE_TEXTURE_RADIUS;
  const dot = new Graphics();
  for (let i = rings; i >= 1; i--)
    dot.circle(radius, radius, (radius * i) / rings).fill({ color: 0xffffff, alpha: ringAlpha });
  if (core > 0) dot.circle(radius, radius, radius * core).fill({ color: 0xffffff, alpha: 1 });
  const texture = pixiApp.renderer.generateTexture({ target: dot, resolution: 2 });
  dot.destroy();
  return texture;
}

const PARTICLE_TEXTURE_RADIUS = 16;
// Crisp mote — currently hidden, see placeParticle.
const PARTICLE_TEXTURE = makeParticleTexture(6, 0.3, 0.22);
// …and the wide, coreless bloom that sits behind it.
const HALO_TEXTURE = makeParticleTexture(10, 0.1, 0);
const HALO_SCALE = 20;

function placeParticle(p: Particle) {
  if (starAnchors.length === 0) {
    p.sprite.visible = false;
    p.halo.visible = false;
    return;
  }

  const index = pickAnchor();
  const anchor = starAnchors[index];
  // Dust hugs its star much more tightly toward the end of the arms.
  const spread = 1 - 0.85 * (index / Math.max(1, starAnchors.length - 1));
  const angle = Math.random() * TWO_PI;
  const distance = anchor.r * (0.8 + Math.random() * 1.5) * spread;
  const x = anchor.x + Math.cos(angle) * distance;
  const y = anchor.y + Math.sin(angle) * distance;
  const size = Math.max(0.35, anchor.r * (0.06 + Math.random() * 0.1));
  const tint = PARTICLE_TINTS[Math.floor(Math.random() * PARTICLE_TINTS.length)];

  // Wide and faint: the glow reads as ambient haze rather than individual specks.
  p.halo.visible = true;
  p.halo.tint = tint;
  p.halo.position.set(x, y);
  p.halo.alpha = 0.02 + Math.random() * 0.03;
  p.halo.scale.set((size * HALO_SCALE) / PARTICLE_TEXTURE_RADIUS);

  // The mote's centre is temporarily hidden — glow only.
  p.sprite.visible = false;
  p.sprite.tint = tint;
  p.sprite.position.set(x, y);
  p.sprite.alpha = 0.6;
  p.sprite.scale.set(size / PARTICLE_TEXTURE_RADIUS);
}

// Re-scatter the dust only when the star layout it hangs off has actually moved.
function layoutParticlesIfNeeded(key: string) {
  if (key === particleLayoutKey) return;
  particleLayoutKey = key;
  for (const p of particles) placeParticle(p);
}

function initParticles() {
  // Two sub-layers so every halo draws behind every mote, and each stays one batch.
  const haloLayer = new Container();
  const coreLayer = new Container();
  particleLayer.addChild(haloLayer, coreLayer);

  particles = Array.from({ length: PARTICLE_COUNT }, () => {
    const sprite = new Sprite(PARTICLE_TEXTURE);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.visible = false;
    coreLayer.addChild(sprite);

    const halo = new Sprite(HALO_TEXTURE);
    halo.anchor.set(0.5);
    halo.blendMode = "add";
    halo.visible = false;
    haloLayer.addChild(halo);

    return { sprite, halo } satisfies Particle;
  });
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

  if (changed) updateWatchText();
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

  // const targetArm1Min = midiNote(0, 4);
  // const targetArm1Max = midiNote(0, 7);
  // const targetArm2Min = midiNote(10, 0);
  // const targetArm2Max = midiNote(10, 3);

  const targetArm1Min = state.arm1_low;
  const targetArm1Max = state.arm1_high;
  const targetArm2Min = state.arm2_low;
  const targetArm2Max = state.arm2_high;

  const scaleArm1 = scale(minArm1, maxArm1, targetArm1Min, targetArm1Max, mappedArm1);
  const scaleArm2 = scale(minArm2, maxArm2, targetArm2Min, targetArm2Max, mappedArm2);

  setNotes(scaleArm1, scaleArm2);
}

// React UI state plumbing (watch/status live in React; canvas draw live here)
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
  updateUiWatch(next);
}

// function resetSimulation() {
//   highlightedIndex = 0;
//   ensureHighlightedPointMatchesMode();
//   playAccumulator = 0;
//   updateWatchText();
//   updateStatusText();
//   requestRender();
// }

function setHighlightMode(nextMode: "all" | "positive" | "negative") {
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

window.addEventListener("resize", () => requestRender());

const controlsPanel = document.querySelector<HTMLElement>("section.panel.controls");
if (!controlsPanel) throw new Error("Missing controls panel section: section.panel.controls");
controlsPanel.replaceChildren();
mountControls(controlsPanel, {
  onPlay: play,
  onHighlightModeChange: setHighlightMode,
  onScheduleRecompute: scheduleRecompute,
});

data = computeSpiral();
computeNotes();
console.log("computing indicies");
computeIndicies();
ensureHighlightedPointMatchesMode();
updateWatchText();
initParticles();
requestRender();
