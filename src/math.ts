const TWO_PI = 2 * Math.PI;
const EPS = 1e-12;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = rand();
  while (v <= Number.EPSILON) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(TWO_PI * v);
}

function attenuation(index: number, p: number, C: number, Ct: number) {
  const turn = (index / p) * C;
  if (C <= Ct) return 1;
  if (turn < Ct) return 1;
  return 1 - (turn - Ct) / (C - Ct);
}

function radiusAtPhi(phi: number, A: number, B: number, N: number) {
  const z = B * Math.tan(phi / (2 * N));
  const denom = Math.log(z);
  if (!Number.isFinite(z) || !Number.isFinite(denom) || z <= 0 || Math.abs(denom) <= EPS) {
    return NaN;
  }
  const r = A / denom;
  return Number.isFinite(r) ? r : NaN;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function computeT(
  A: number,
  B: number,
  N: number,
  C: number,
  _Ct: number,
  validPhis: number[],
  validRhos: number[],
) {
  const tipTurn = clamp(0, 1e-9, Math.max(C - 1e-9, 1e-9));
  const phiTip = TWO_PI * tipTurn;
  const rTip = radiusAtPhi(phiTip, A, B, N);

  if (Number.isFinite(rTip) && Math.abs(rTip) > EPS) {
    return Math.abs(rTip) * phiTip;
  }

  if (validPhis.length === 0) return 0;
  return Math.abs(validRhos[0]) * validPhis[0];
}

function rotatePoint(x: number, y: number, angle: number) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return [ca * x - sa * y, sa * x + ca * y];
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
  if (!Number.isFinite(v)) return '—';
  if (digits === 0) return Math.round(v).toString();
  return (+v).toFixed(digits);
}

export {
  mulberry32,
  gaussianRandom,
  attenuation,
  radiusAtPhi,
  computeT,
  rotatePoint,
  modTwoPi,
  markerArea,
  notePerSecond,
  formatValue,
};
