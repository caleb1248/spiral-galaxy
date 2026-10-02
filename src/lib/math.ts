const TWO_PI = 2 * Math.PI;
const EPS = 1e-12;

/** $T=0$ — constant. */
const T = 0;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: one draw from the standard normal, from a uniform source. */
function standardNormal(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = rand();
  while (v <= Number.EPSILON) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(TWO_PI * v);
}

/** $G_{N}=\operatorname{normaldist}\left(0,d\right)$ */
function normalDist(rand: () => number, mean: number, stddev: number) {
  return {
    /** $G_{g}=G_{N}.\operatorname{random}\left(p\right)$ */
    random(len: number) {
      return Array.from({ length: len }, () => mean + stddev * standardNormal(rand));
    },
  };
}

/**
 * $C\cdot\frac{N\arctan\left(\frac{1}{B}\right)}{\pi}$
 *
 * Every appearance of $C$ in the equations below is this scaled form, never the
 * raw slider value.
 */
function scaledC(C: number, B: number, N: number) {
  return (C * N * Math.atan(1 / B)) / Math.PI;
}

/** $a_{dj}=\left\{\frac{i}{p}<\frac{C_{t}}{C}:1,1-\frac{\left(\frac{i}{p}C-C_{t}\right)}{C-C_{t}}\right\}$ */
function attenuation(i: number, p: number, C: number, Ct: number) {
  if (i / p < Ct / C) return 1;
  return 1 - ((i / p) * C - Ct) / (C - Ct);
}

/**
 * The denominator shared by $r_{g1}$ and $r_{g2}$:
 * $\log\left(B\cdot\tan\left(\frac{\frac{i}{p}2\pi C}{2N}\right)\right)$
 *
 * Returns NaN where the logarithm is undefined or so close to zero that the
 * radius blows up, so the caller can drop that star.
 */
function spiralDenominator(i: number, B: number, N: number) {
  const z = B * Math.tan(i / (2 * N));
  if (!Number.isFinite(z) || z <= 0) return NaN;
  const denom = Math.log10(z);
  if (!Number.isFinite(denom) || Math.abs(denom) <= EPS) return NaN;
  return denom;
}

function modTwoPi(theta: number) {
  return ((theta % TWO_PI) + TWO_PI) % TWO_PI;
}

function markerArea(R: number, state: { s_min: number; s_max: number; R_d: number }) {
  const sMin = Number(state.s_min);
  const sMax = Math.max(sMin, Number(state.s_max));
  const Rd = Math.max(1e-9, Number(state.R_d));
  return sMin + (sMax - sMin) * Math.exp(-R / Rd);
}

function notePerSecond(tempo: number, npb: number) {
  return (tempo / 60) * npb;
}

function formatValue(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "—";
  if (digits === 0) return Math.round(v).toString();
  return (+v).toFixed(digits);
}

export {
  T,
  mulberry32,
  normalDist,
  scaledC,
  attenuation,
  spiralDenominator,
  modTwoPi,
  markerArea,
  notePerSecond,
  formatValue,
};
