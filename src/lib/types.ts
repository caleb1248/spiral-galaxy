interface Point {
  i: number;
  phi: number;
  theta: number;
  thetaMod: number;
  eta1: number;
  eta2: number;
  x2pre: number;
  y2pre: number;
  xs: number;
  ys: number;
  x1r: number;
  y1r: number;
  x2pr: number;
  y2pr: number;
  xsr: number;
  ysr: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  xs1: number;
  ys1: number;
  xs2: number;
  ys2: number;
  R1: number;
  R2: number;
  stepDist: number;
}

interface State {
  A: number;
  B: number;
  N: number;
  C: number;
  d: number;
  C_t: number;
  p: number;
  s_min: number;
  s_max: number;
  R_d: number;
  tempo: number;
  npb: number;
  seed: number;
  // Arm 1 and Arm 2 note ranges in MIDI note numbers
  arm1_low: number;
  arm1_high: number;
  arm2_low: number;
  arm2_high: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface SpiralData {
  points: Point[];
  bounds: Bounds | null;
  T: number;
  error: string | null;
}

interface ToCanvasFn {
  (x: number, y: number): [number, number];
}

interface UiWatch {
  index: string;
  R: string;
  theta: string;
  step: string;
  eta: string;
}

export type { Point, Bounds, SpiralData, ToCanvasFn, State, UiWatch };
