import type { State } from './types';

const extraSliderDefs = [
  {
    key: 'A',
    label: 'Arm offset',
    min: 0.1,
    max: 2.0,
    step: 0.01,
    value: 0.8,
    digits: 3,
  },
  {
    key: 'B',
    label: 'Scale factor',
    min: 1.1,
    max: 10.0,
    step: 0.1,
    value: 2.0,
    digits: 3,
  },
  {
    key: 'N',
    label: 'Windings',
    min: 1,
    max: 50,
    step: 1,
    value: 16,
    digits: 0,
  },
  {
    key: 'C',
    label: 'Angular coverage',
    min: 0.1,
    max: 2.0,
    step: 0.01,
    value: 0.58,
    digits: 3,
  },
  {
    key: 'd',
    label: 'Noise std',
    min: 0.0,
    max: 0.5,
    step: 0.001,
    value: 0.1,
    digits: 4,
  },
  {
    key: 'C_t',
    label: 'Transition',
    min: 0.0,
    max: 1.0,
    step: 0.0001,
    value: 0.0573,
    digits: 4,
  },
  {
    key: 'p',
    label: 'Number of points',
    min: 20,
    max: 200,
    step: 20,
    value: 40,
    digits: 0,
  },

  {
    key: 's_min',
    label: 'Minimum circle area',
    min: 0.25,
    max: 80,
    step: 0.25,
    value: 4.0,
    digits: 2,
  },
  {
    key: 's_max',
    label: 'Maximum circle area',
    min: 1,
    max: 320,
    step: 1,
    value: 30.0,
    digits: 1,
  },
  {
    key: 'R_d',
    label: 'Circle size',
    min: 0.01,
    max: 5.0,
    step: 0.01,
    value: 2,
    digits: 3,
  },
  {
    key: 'tempo',
    label: 'Tempo (Beats / Minute)',
    min: 40,
    max: 240,
    step: 1,
    value: 120,
    digits: 0,
  },
  {
    key: 'npb',
    label: 'Notes per beat',
    min: 1,
    max: 8,
    step: 1,
    value: 2,
    digits: 0,
    format: (v: number) => '1/' + 2 ** v,
  },
  {
    key: 'seed',
    label: 'Random seed',
    min: 0,
    max: 1000,
    step: 1,
    value: 42,
    digits: 0,
  },
  {
    key: 'low',
    label: 'lower octave',
    min: 1,
    max: 4,
    step: 1,
    value: 2,
    digits: 0,
  },
  {
    key: 'hi',
    label: 'upper octave',
    min: 3,
    max: 7,
    step: 1,
    value: 5,
    digits: 0,
  },
];

function getSliderDef(key: string) {
  return extraSliderDefs.find((def) => def.key === key)!;
}

const SHOWN_SLIDERS = ['A', 'B', 'N', 'C', 'd'];

const initialState: State = Object.fromEntries(
  extraSliderDefs.map((def) => [def.key, def.value]),
) as unknown as State;
const state = { ...initialState };

export { state, extraSliderDefs, SHOWN_SLIDERS, getSliderDef };
