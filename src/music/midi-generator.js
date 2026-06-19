// This is a midi generator using scribbletune.
// For now we will just write some basic patterns.

import { clip, midi } from 'scribbletune';
import * as Tone from 'tone';

const numberToNoteMap = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

function convertNote(/** @type {number} */ number) {
  let baseNote = numberToNoteMap[Math.floor(number % 7)];
  const octave = Math.floor(number / 7) + 2;
  if (number % 1 === 0.5) baseNote += '#';

  return `${baseNote}${octave}`;
}

function convertNoteChromatic(/** @type {number} */ number) {
  const chromaticScale = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  let baseNote = chromaticScale[Math.floor(number % 12)];
  const octave = Math.floor(number / 12);
  return `${baseNote}${octave}`;
}

function removeCommasAndSpaces(/** @type {string} */ str) {
  return str.replace(/[, ]/g, '');
}

// function convertMelody(/** @type {string} */ melody) {
//   let notes = [];
//   let pattern = '';
//   let currentIndex = 0;
//   const numbers = melody.matchAll(/\d+(\.\d+)?/g);

//   for (const number of numbers) {
//     notes.push(convertNote(parseFloat(number[0])));
//     pattern += removeCommasAndSpaces(melody.slice(currentIndex, number.index)) + 'x';
//     currentIndex = number.index + number[0].length;
//   }

//   pattern += removeCommasAndSpaces(melody.slice(currentIndex));

//   console.log(notes);
//   console.log(pattern);

//   return { notes, pattern };
// }

// // We will use a simple hard-coded melody for now.

// const sampleClip = clip({ ...convertMelody('1, 2, 3.5, 4, 5, 4, 3.5, [3.5, 4, 2], 1___') });

// const midiUrl = midi(sampleClip);
// const midiData = await Midi.fromUrl(midiUrl);

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

let arm1 = [];
let arm2 = [];

/**
 * @param {number[], number[]} arm1
 * @param {number[], number[]} arm2
 */
export function setNotes(newArm1, newArm2) {
  arm1 = newArm1;
  arm2 = newArm2;
}

/**
 * plays a note
 * @param {number} index
 * @param {number} speed points/second
 */
export function playNote(index, speed, doubleSpiral = false) {
  if (!started) {
    Tone.start();
    started = true;
  }

  _playNote(index, speed, 1);
  if (doubleSpiral) _playNote(arm2.length - 1 - index, speed, 2);
}

/**
 *
 * @param {number} index
 * @param {number} speed
 * @param {(0|1)} arm
 */
function _playNote(index, speed, arm = 1) {
  const notes = arm === 1 ? arm1 : arm2;
  const note = convertNoteChromatic(notes[index]);
  // console.log(notes[index], note, speed);
  // console.log(notes);
  // console.log(`Playing note: ${note} at index ${index}`);
  piano.triggerAttackRelease(note, 1 / speed, Tone.now());
}
