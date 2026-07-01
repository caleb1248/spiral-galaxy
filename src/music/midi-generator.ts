// This is a midi generator using scribbletune.
// For now we will just write some basic patterns.

import { mergeTracks } from './merge-tracks';
import * as Tone from 'tone';
import { exportPdf } from '../renderer/render';
import { state } from '../state';

const numberToNoteMap = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

function convertNote(number: number) {
  let baseNote = numberToNoteMap[Math.floor(number % 7)];
  const octave = Math.floor(number / 7) + 2;
  if (number % 1 === 0.5) baseNote += '#';

  return `${baseNote}${octave}`;
}

function convertNoteChromatic(number: number) {
  const chromaticScale = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  let baseNote = chromaticScale[Math.floor(number % 12)];
  const octave = Math.floor(number / 12);
  return `${baseNote}${octave}`;
}

function removeCommasAndSpaces(str: string) {
  return str.replace(/[, ]/g, '');
}

function getMidiData() {
  const tracks = [
      arm1.map((note) => ({ note, duration: 0.25 })),
      arm2.map((note) => ({ note, duration: 0.25 })),
    ],
    names = ['Arm 1', 'Arm 2'],
    channels = [0, 1];

  if (!(globalThis as any).doubleNote) {
    tracks.pop();
    names.pop();
    channels.pop();
  }

  const midiData = mergeTracks(tracks, {
    bpm: state.tempo as number,
    npb: state.npb as number,
    names: ['Arm 1', 'Arm 2'],
    channels: [0, 1],
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
let scheduled = false;
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
export function playNote(index: number, speed: number, doubleSpiral = false) {
  if (!started) {
    Tone.start();
    started = true;
  }

  _playNote(index, speed, 1);
  if (doubleSpiral) _playNote(index, speed, 2);
}

function _playNote(index: number, speed: number, arm: 1 | 2 = 1) {
  const notes = arm === 1 ? arm1 : arm2;
  const note = convertNoteChromatic(notes[index]);
  // console.log(notes[index], note, speed);
  // console.log(notes);
  // console.log(`Playing note: ${note} at index ${index}`);
  piano.triggerAttackRelease(note, 1 / speed, Tone.now());
}

document.getElementById('export-midi')?.addEventListener('click', () => {
  const midiFile = new File([getMidiData()], 'galaxy.mid', {
    type: 'audio/midi',
  });

  const url = URL.createObjectURL(midiFile);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'galaxy.mid';
  a.click();
});
document.getElementById('export-pdf')?.addEventListener('click', async () => {
  const midiData = getMidiData();
  const pdfData = await exportPdf(midiData);

  // returns a uint8array of the PDF data

  // download the PDF file
  const blob = new Blob([pdfData as any], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'score.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
