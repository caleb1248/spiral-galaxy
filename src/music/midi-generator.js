// This is a midi generator using scribbletune.
// For now we will just write some basic patterns.

import { clip, midi } from 'scribbletune';
import { mergeTracks } from './merge-tracks';
import * as Tone from 'tone';

const numberToNoteMap = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

function convertNote(/** @type {number} */ number) {
  let baseNote = numberToNoteMap[Math.floor(number % 7)];
  const octave = Math.floor(number / 7) + 2;
  if (number % 1 === 0.5) baseNote += '#';

  return `${baseNote}${octave}`;
}

function convertNoteChromatic(/** @type {number} */ number, index = -1) {
  const chromaticScale = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  let baseNote = chromaticScale[Math.floor(number % 12)];
  const octave = Math.floor(number / 12);
  return `${baseNote}${octave}`;
}

function removeCommasAndSpaces(/** @type {string} */ str) {
  return str.replace(/[, ]/g, '');
}

function exportMidi() {
  function getPattern(/** @type {number[]} */ arm) {
    let pattern = '[xxxx]'.repeat(Math.floor(arm.length / 4));

    const leftover = arm.length % 4;
    if (leftover > 0) {
      pattern += `[${'x'.repeat(leftover)}${'-'.repeat(4 - leftover)}]`;
    }

    return pattern;
  }

  const tracks = [
      arm1.map((note) => ({ note, duration: 0.25 })),
      arm2.map((note) => ({ note, duration: 0.25 })),
    ],
    names = ['Arm 1', 'Arm 2'],
    channels = [0, 1];

  if (!globalThis.doubleNote) {
    tracks.pop();
    names.pop();
    channels.pop();
  }

  const midiData = mergeTracks(tracks, {
    bpm: 120,
    names: ['Arm 1', 'Arm 2'],
    channels: [0, 1],
  });

  const midiFile = new File([new Uint8Array(midiData.toArray())], 'galaxy.mid', {
    type: 'audio/midi',
  });

  const url = URL.createObjectURL(midiFile);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'galaxy.mid';
  a.click();
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
  if (doubleSpiral) _playNote(index, speed, 2);
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

document.getElementById('export-midi').addEventListener('click', exportMidi);
