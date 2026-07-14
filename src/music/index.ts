// This is a midi generator using scribbletune.
// For now we will just write some basic patterns.

import { generateMidiFile } from './merge-tracks';
import * as Tone from 'tone';
import { renderPdfFromMidi } from '../renderer/render';
import { state } from '../state';
import { downloadFile, midiNote } from '../utils';
import { patchKeySignature } from './patch-key-signature';

function convertNoteChromatic(number: number) {
  const chromaticScale = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  let baseNote = chromaticScale[Math.floor(number % 12)];
  console.log(Math.floor(number % 12), baseNote);
  const octave = Math.floor(number / 12);
  return `${baseNote}${octave}`;
}

const introPatterns = [
  [
    midiNote(5, 3), //f3
    midiNote(9, 3), //a3
    midiNote(2, 4), //d4
    midiNote(9, 3), //a3
    midiNote(2, 4), //d4
    midiNote(9, 3), //a3
    midiNote(5, 3), //f3
    midiNote(2, 4), //d4
    midiNote(9, 3), //a3
    midiNote(2, 4), //d4
  ],

  [
    midiNote(4, 3), //e3
    midiNote(9, 3), //a3
    midiNote(1, 4), //c#4
    midiNote(9, 3), //a3
    midiNote(1, 4), //c#4
    midiNote(9, 3), //a3
    midiNote(4, 3), //e3
    midiNote(1, 4), //c#4
    midiNote(9, 3), //a3
    midiNote(1, 4), //c#4
  ],
];

const intro = [
  ...introPatterns[0],
  ...introPatterns[0],
  ...introPatterns[1],
  ...introPatterns[1],
].map((note) => ({ note, duration: 1 / +state.npb }));

function getMidiData() {
  const tracks = [
      arm1.map((note) => ({ note, duration: 1 / +state.npb })),
      arm2.toReversed().map((note) => ({ note, duration: 1 / +state.npb })),
    ],
    names = ['Arm 1', 'Arm 2'],
    channels = [0, 1];

  // tracks[0].unshift(...Array(intro.length).fill(null));
  tracks[1].unshift(...intro);

  const midiData = generateMidiFile(tracks, {
    bpm: state.tempo as number,
    npb: state.npb as number,
    names,
    channels,
  });

  return midiData.toArray() as Uint8Array<ArrayBuffer>;
}

const piano = new Tone.Sampler({
  urls: {
    C4: 'C4.mp3',
    'D#4': 'Ds4.mp3',
    'F#4': 'Fs4.mp3',
    A4: 'A4.mp3',
  },
  release: 1,
  baseUrl: 'https://tonejs.github.io/audio/salamander/',
}).toDestination();

await Tone.loaded();

let started = false;
// Web Audio API requires a user-initiated event to start.

Tone.getContext().lookAhead = 0;

let arm1: number[] = [];
let arm2: number[] = [];

export function setNotes(newArm1: number[], newArm2: number[]) {
  arm1 = newArm1;
  arm2 = newArm2;
}

/**
 * plays a note
 * @param {number} index
 * @param {number} speed points/second
 */
export function playNote(index: number, speed: number) {
  if (!started) {
    Tone.start();
    started = true;
  }

  _playNote(indicies[0][index], speed, 1);
  _playNote(indicies[1][index], speed, 2);
}

function _playNote(index: number | null, speed: number, arm: 1 | 2 = 1) {
  if (!index) return;
  // console.log(arguments);
  const notes = arm === 1 ? arm1 : arm2;
  const note = convertNoteChromatic(notes[index]);
  // console.log('length check in _playnote', notes.length, index);
  // console.log(notes[index], note, speed);
  // console.log(notes);
  // console.log(`Playing note: ${note} at index ${index}`);
  piano.triggerAttackRelease(note, 1 / speed, Tone.now());
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || !e.ctrlKey || e.key !== 's') return;
  e.preventDefault();

  downloadFile(patchKeySignature(getMidiData()), 'galaxy.mid', 'audio/midi');
});

export async function exportPdf() {
  const midiData = getMidiData();

  patchKeySignature(midiData);

  const pdfData = await renderPdfFromMidi(patchKeySignature(midiData));
  downloadFile(pdfData, 'galaxy.pdf', 'application/pdf');
}

export const indicies = [[], []] as [(number | null)[], (number | null)[]];

(globalThis as any).indicies = indicies;
