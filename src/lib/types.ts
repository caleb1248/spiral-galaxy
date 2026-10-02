/** Hue in degrees (0–360, wrapped), saturation and value in 0–1. */
interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

interface Point {
  i: number;
  /** Star colour, derived from the star's $G_{g}$ draw. Stars without one default to white. */
  color?: Hsva;
  eta1: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  R1: number;
  R2: number;
  stepDist: number;
}

interface Note {
  /** If null, the note is a rest */
  midi: number | null;
  /** Used for measure splitting */
  length: number;
}

interface State {
  A: number;
  B: number;
  N: number;
  C: number;
  d: number;
  C_t: number;
  p: number;
  /** Rendered-only stars inserted between each pair of played stars. */
  p_e: number;
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
  /**
   * Stars drawn to fill out the arms but never sounded: they are left out of the note
   * mapping and out of `indicies`, so the played sequence is identical with or without them.
   * Their `i` is fractional — it sits between the `i` of the played points they fall between.
   */
  extraPoints: Point[];
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
  step: string;
  eta: string;
}

export type { Hsva, Point, Note, Bounds, SpiralData, ToCanvasFn, State, UiWatch };
