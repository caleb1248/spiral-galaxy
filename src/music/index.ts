import { generateMidiFile } from "./midi/merge-tracks";
import * as Tone from "tone";
import { renderPdfFromXML } from "../renderer/render";
import { state } from "../state";
import { downloadFile, fetchText, findNearest } from "../utils";
import { patchKeySignature } from "./midi/patch-key-signature";
import { populateComposition } from "./musicxml";
import type { TemplateData } from "./template-data";

const chromaticScale = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];

const cMajorMidiNotes = [0, 2, 4, 5, 7, 9, 11];
const chromaticMidiNotes = Array.from({ length: 12 }, (_, i) => i);

function adjustNoteToScale(note: number, scale: number[]): number {
  const octave = Math.floor(note / 12);
  const noteInScale = note % 12;
  const nearestNote = findNearest(noteInScale, scale);
  return nearestNote + octave * 12;
}

/**
 * Converts a midi note to the equivalent string representation.
 */
function convertNote(number: number, scale: number[] = chromaticMidiNotes): string {
  // The number is a midi note which is chromatic. Use findNearest to approximate it to the nearest note in the provided scale.
  const octave = Math.floor(number / 12);
  const nearestNote = findNearest(number % 12, scale);

  return `${chromaticScale[nearestNote]}${octave}`;
}

function getMidiData() {
  const tracks = [
      arm1.map((note) => ({
        note: adjustNoteToScale(note, cMajorMidiNotes),
        duration: 1 / +state.npb,
      })),
      arm2.toReversed().map((note) => ({
        note: adjustNoteToScale(note, cMajorMidiNotes),
        duration: 1 / +state.npb,
      })),
    ],
    names = ["Arm 1", "Arm 2"],
    channels = [0, 1];

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
    C4: "C4.mp3",
    "D#4": "Ds4.mp3",
    "F#4": "Fs4.mp3",
    A4: "A4.mp3",
  },
  release: 1,
  baseUrl: "https://tonejs.github.io/audio/salamander/",
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

/**
 * Plays the midi note at the given index for the given arm.
 */
function _playNote(index: number | null, speed: number, arm: 1 | 2 = 1) {
  if (!index) return;

  const notes = arm === 1 ? arm1 : arm2;
  const note = convertNote(notes[index], cMajorMidiNotes);
  piano.triggerAttackRelease(note, 1 / speed, Tone.now());
}

window.addEventListener("keydown", (e) => {
  if (e.repeat || !e.ctrlKey || e.key !== "s") return;
  e.preventDefault();

  downloadFile(patchKeySignature(getMidiData()), "galaxy.mid", "audio/midi");
});

export async function exportPdf() {
  const xml = populateComposition(TEMPLATE_XML, TEMPLATE_DATA, arm1, arm2.toReversed()); // reverse the arm2 for contrary motion

  // downloadFile(new TextEncoder().encode(xml), "galaxy.musicxml", "application/xml");
  const pdfData = await renderPdfFromXML(xml);
  downloadFile(pdfData, "galaxy.pdf", "application/pdf");
}

export const indicies = [[], []] as [(number | null)[], (number | null)[]];

const TEMPLATE_XML = await fetchText("/templates/template-1.musicxml");
const TEMPLATE_DATA = JSON.parse(await fetchText("/templates/template-1.json")) as TemplateData;
