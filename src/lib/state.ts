import { convertNote } from "./music";
import type { State } from "./types";

function formatNote(v: number): string {
  return convertNote(v).toUpperCase();
}

const extraSliderDefs = [
  {
    key: "A",
    label: "A",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.7,
    digits: 2,
  },
  {
    key: "B",
    label: "B",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    digits: 2,
  },
  {
    key: "N",
    label: "N",
    min: 1,
    max: 25,
    step: 0.1,
    value: 8,
    digits: 1,
  },
  {
    key: "C",
    label: "C",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.5,
    digits: 2,
  },
  {
    key: "d",
    label: "d",
    min: -5,
    max: 5,
    step: 0.1,
    value: 0.7,
    digits: 1,
  },
  {
    key: "C_t",
    label: "C_t",
    min: -10,
    max: 10,
    step: 0.1,
    value: -2.7,
    digits: 1,
  },
  // math.md fixes p at 40; the slider is kept for debugging but hidden from the UI.
  {
    key: "p",
    label: "p",
    min: 20,
    max: 200,
    step: 20,
    value: 40,
    digits: 0,
  },

  {
    key: "s_min",
    label: "Minimum circle area",
    min: 0.25,
    max: 80,
    step: 0.25,
    value: 4.0,
    digits: 2,
  },
  {
    key: "s_max",
    label: "Maximum circle area",
    min: 1,
    max: 320,
    step: 1,
    value: 30.0,
    digits: 1,
  },
  {
    key: "R_d",
    label: "Circle size",
    min: 0.01,
    max: 5.0,
    step: 0.01,
    value: 2,
    digits: 3,
  },
  {
    key: "tempo",
    label: "Tempo (Beats / Minute)",
    min: 40,
    max: 240,
    step: 1,
    value: 120,
    digits: 0,
  },
  {
    key: "npb",
    label: "Notes per beat",
    min: 1,
    max: 8,
    step: 1,
    value: 2,
    digits: 0,
    format: (v: number) => "1/" + 2 ** v,
  },
  {
    key: "seed",
    label: "Random seed",
    min: 0,
    max: 1000,
    step: 1,
    value: 42,
    digits: 0,
  },
  {
    key: "arm1_low",
    label: "Arm 1: lowest note (C4 is middle C, piano ranges from A0 to C8)",
    min: 0,
    max: 127,
    step: 1,
    value: 48,
    digits: 0,
    format: (v: number) => formatNote(v),
  },
  {
    key: "arm1_high",
    label: "Arm1: highest note",
    min: 0,
    max: 127,
    step: 1,
    value: 84,
    digits: 0,
    format: (v: number) => formatNote(v),
  },
  {
    key: "arm2_low",
    label: "Arm2: lowest note",
    min: 0,
    max: 127,
    step: 1,
    value: 21,
    digits: 0,
    format: (v: number) => formatNote(v),
  },
  {
    key: "arm2_high",
    label: "Arm2: highest note",
    min: 0,
    max: 127,
    step: 1,
    value: 45,
    digits: 0,
    format: (v: number) => formatNote(v),
  },
];

function getSliderDef(key: string) {
  return extraSliderDefs.find((def) => def.key === key)!;
}

const SHOULD_HIDE_UNEXPOSED_SLIDERS = true;

const SHOWN_SLIDERS = SHOULD_HIDE_UNEXPOSED_SLIDERS
  ? ["A", "B", "N", "C", "d", "arm1_low", "arm1_high", "arm2_low", "arm2_high"]
  : extraSliderDefs.map((def) => def.key);

const initialState: State = Object.fromEntries(
  extraSliderDefs.map((def) => [def.key, def.value]),
) as unknown as State;
const state = { ...initialState };

export { state, extraSliderDefs, SHOWN_SLIDERS, getSliderDef };
