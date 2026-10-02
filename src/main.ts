import "./style.css";
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type ColorSource,
} from "pixi.js";
import { extraSliderDefs, state } from "./lib/state";
import { setNotes, playNote, indicies } from "./lib/music";
import { mountControls, uiStateRef, updateWatch as updateUiWatch } from "./lib/ui";
import { hsvToHex, /*midiNote,*/ scale, waitForImageToLoad } from "./lib/utils";
import starfieldImageUrl from "./assets/starfield.png";
import type { SpiralData, Point, Bounds, ToCanvasFn, UiWatch, Hsva } from "./lib/types";
import {
  T,
  attenuation,
  formatValue,
  markerArea,
  modTwoPi,
  mulberry32,
  normalDist,
  notePerSecond,
  scaledC,
  spiralDenominator,
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

type SpiralParams = {
  A: number;
  B: number;
  N: number;
  C: number;
  C_t: number;
  p: number;
  d: number;
};

/**
 * One star pair (arm 1 and arm 2) at position `i` along the spiral. `i` is an integer for the
 * played stars and fractional for the rendered-only ones; the equations do not care which.
 * `g` is this star's draw from $G_{g}$.
 */
function spiralPoint(i: number, G_g: number, { A, B, N, C, C_t, p, d }: SpiralParams): Point {
  // $a_{dj}=\left\{\frac{i}{p}<\frac{C_{t}}{C}:1,1-\frac{\left(\frac{i}{p}C-C_{t}\right)}{C-C_{t}}\right\}$
  const a_dj = i / p < C_t / C ? 1 : 1 - ((i / p) * C - C_t) / (C - C_t);

  const r_g1 = (A + G_g * a_dj) / Math.log10(B * Math.tan(((i / p) * Math.PI * C) / N));
  const r_g2 = (-A + G_g * a_dj) / Math.log10(B * Math.tan(((i / p) * Math.PI * C) / N));

  const x1 = r_g1 * Math.cos((i / p) * TWO_PI * C - T / Math.abs(r_g1));
  const y1 = r_g1 * Math.sin((i / p) * TWO_PI * C - T / Math.abs(r_g1));

  const x2 = r_g2 * Math.cos((i / p) * TWO_PI * C - T / Math.abs(r_g2));
  const y2 = r_g2 * Math.sin((i / p) * TWO_PI * C - T / Math.abs(r_g2));

  // s_g is 8.7 in the graph. s = |G_g| * s_g
  const color: Hsva = {
    h: 185 + Math.round(Math.abs(G_g) / (3 * d)),
    s: Math.abs(G_g),
    v: 1,
    a: 1,
  };

  // console.log("the color is hsv(" + color.h + ", " + color.s + ", " + color.v + ")");
  console.log("G_g:", Math.abs(G_g) * 8.7);
  return {
    i,
    eta1: Math.atan2(y1, x1),
    color,
    x1,
    y1,
    x2,
    y2,
    R1: Math.abs(r_g1),
    R2: Math.abs(r_g2),
    stepDist: 0,
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
  const d = +state.d;
  const p = Math.max(2, Math.round(+state.p));
  const C_t = +state.C_t;
  const seed = Math.round(+state.seed);
  const rand = mulberry32(seed);

  // $C\cdot\frac{N\arctan\left(\frac{1}{B}\right)}{\pi}$ — C is only ever used scaled.
  // const C = scaledC(+state.C, B, N);
  const C = +state.C;

  // $G_{N}=\operatorname{normaldist}\left(0,d\right)$
  // $G_{g}=G_{N}.\operatorname{random}\left(p\right)$

  const points: Point[] = [];

  const G_N = normalDist(rand, 0, d);
  const G_g = G_N.random(p);

  const params: SpiralParams = { A, B, N, C, C_t, p, d };

  for (let i = 1; i <= p; i++) points.push(spiralPoint(i, G_g[i - 1], params));

  if (points.length < 2) {
    return {
      points: [],
      extraPoints: [],
      bounds: null,
      T,
      error: "Not enough valid points for these parameter settings.",
    };
  }

  // Silent filler stars, spread evenly along the spiral between the first and last played
  // star. Their scatter is drawn from the same generator *after* G_g, so the played stars
  // keep the exact positions they would have had with p_e at 0.
  const extraPoints: Point[] = [];
  const extraCount = Math.max(0, Math.round(+state.p_e));
  if (extraCount > 0) {
    const G_e = G_N.random(extraCount);
    for (let k = 0; k < extraCount; k++) {
      extraPoints.push(spiralPoint(1 + ((k + 1) * (p - 1)) / (extraCount + 1), G_e[k], params));
    }
  }

  for (let j = 0; j < points.length; j++) {
    const a = points[j];
    const b = points[Math.min(j + 1, points.length - 1)];
    a.stepDist = j < points.length - 1 ? Math.hypot(a.x1 - b.x1, a.y1 - b.y1) : 0;
  }

  // Extras are drawn, so they have to be framed too — otherwise a stray filler star can
  // scatter outside the viewport.
  const bounds = computeBounds([...points, ...extraPoints]);
  return { points, extraPoints, bounds, T, error: null };
}

function computeBounds(points: Point[]): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    minX = Math.min(minX, pt.x1, pt.x2);
    maxX = Math.max(maxX, pt.x1, pt.x2);
    minY = Math.min(minY, pt.y1, pt.y2);
    maxY = Math.max(maxY, pt.y1, pt.y2);
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

// The marker sizes `markerArea` produces were tuned against a galaxy about this wide in
// world units (the default parameters span ~4.4). A galaxy wider than this gets zoomed out
// to fit the canvas, so its stars and dust shrink by the same factor — and vice versa.
const REFERENCE_WORLD_SPAN = 4.4;

type Transform = {
  toCanvas: ToCanvasFn;
  /** Marker-radius multiplier: how far the view is zoomed relative to a reference galaxy. */
  zoom: number;
};

function makeTransform(bounds: Bounds, width: number, height: number): Transform {
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

  // Dividing by the scale a reference-sized galaxy would get cancels the canvas dimensions
  // out, so markers follow the galaxy's size and not the window's.
  const referenceScale = Math.min(plotW, plotH) / REFERENCE_WORLD_SPAN;
  const zoom = clamp(scale / referenceScale, 0.15, 4);

  return {
    zoom,
    toCanvas(x, y) {
      return [canvasCx + (x - worldCx) * scale, canvasCy - (y - worldCy) * scale];
    },
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

  const { toCanvas, zoom } = makeTransform(data.bounds, width, height);
  drawPoints(toCanvas, zoom, data.points, data.extraPoints);
  layoutParticlesIfNeeded(`${spiralVersion}:${width}x${height}`);

  const pt1Index = indicies[0][highlightedIndex];
  const pt2Index = indicies[1][highlightedIndex];
  if (typeof pt1Index === "number") drawHighlight(toCanvas, zoom, data.points[pt1Index]);

  if (typeof pt2Index === "number") drawHighlight(toCanvas, zoom, data.points[pt2Index], 2);
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

function drawStar(
  circle: Graphics,
  cx: number,
  cy: number,
  radius: number,
  fill: ColorSource = "white",
  stroke: string | number | null = null,
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
  circle.fill({ color: fill });
  if (stroke) circle.stroke({ color: stroke, width: 1 });
}

function drawPoints(toCanvas: ToCanvasFn, zoom: number, points: Point[], extraPoints: Point[]) {
  // All stars share one Graphics: hundreds of separate ones would be hundreds of draw calls.
  const stars = new Graphics();
  starAnchors = [];

  // Played and silent stars are drawn identically; the only thing that orders them here is
  // `i`, which `placeParticle` relies on to tighten the dust toward the ends of the arms.
  const ordered =
    extraPoints.length === 0 ? points : [...points, ...extraPoints].sort((a, b) => a.i - b.i);

  for (const pt of ordered) {
    const [x1, y1] = toCanvas(pt.x1, pt.y1);
    const [x2, y2] = toCanvas(pt.x2, pt.y2);
    // Marker areas are world-sized, so the view's zoom carries them onto the canvas.
    const r1 = Math.sqrt(markerArea(pt.R1, state) / Math.PI) * zoom;
    const r2 = Math.sqrt(markerArea(pt.R2, state) / Math.PI) * zoom;
    // Both arms of a point share its colour; white until something assigns `pt.color`.
    // Pixi reads a bare {h,s,v} object as 0–100 saturation/value, so pack it to 0xRRGGBB first.
    const fill = pt.color ? { h: pt.color.h, s: pt.color.s * 100, v: pt.color.v * 100 } : "white";

    drawStar(stars, x1, y1, r1, fill);
    drawStar(stars, x2, y2, r2, fill);
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

function drawHighlight(toCanvas: ToCanvasFn, zoom: number, pt: Point | null, arm = 1) {
  if (!pt) return;
  const [x, y] = toCanvas(arm === 1 ? pt.x1 : pt.x2, arm === 1 ? pt.y1 : pt.y2);
  const baseRadius = Math.sqrt(markerArea(arm === 1 ? pt.R1 : pt.R2, state) / Math.PI) * zoom;
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

const PARTICLE_TEXTURE_RADIUS = 8;
// Crisp mote — currently hidden, see placeParticle.
const PARTICLE_TEXTURE = makeParticleTexture(6, 0.3, 0.22);
// …and the wide, coreless bloom that sits behind it.
const HALO_TEXTURE = makeParticleTexture(10, 0.1, 0);
const HALO_SCALE = 14;

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
