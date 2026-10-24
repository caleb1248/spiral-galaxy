import * as Tone from "tone";
import { renderPdfFromXML } from "../webmscore";
import { appendPlotPage, type EquationParams } from "../pdf-plot-page";
import { downloadFile, fetchText, findNearest } from "../utils";
import { populateComposition } from "./xml/main";
import type { TemplateData } from "./xml/template-data";
import type { Note } from "../types";
import { generateMidiFile } from "./midi/merge-tracks";
import { patchKeySignature } from "./midi/patch-key-signature";
import { constants } from "./constants";
import formatXml from "../debug-format-xml";

const chromaticMidiNotes = Array.from({ length: 12 }, (_, i) => i);

// @ts-ignore not used now, may use later.
function adjustNoteToScale(note: number, scale: number[]): number {
  const octave = Math.floor(note / 12);
  const noteInScale = note % 12;
  const nearestNote = findNearest(noteInScale, scale);
  return nearestNote + octave * 12;
}

/**
 * Converts a midi note to the equivalent string representation.
 */
export function convertNote(number: number, scale: number[] = chromaticMidiNotes): string {
  // The number is a midi note which is chromatic. Use findNearest to approximate it to the nearest note in the provided scale.
  const octave = Math.floor(number / 12);
  const nearestNote = findNearest(number % 12, scale);

  return `${constants.CHROMATIC_SCALE[nearestNote]}${octave}`;
}

const piano = new Tone.Sampler({
  urls: {
    12: "C0.mp3",
    15: "Ds0.mp3",
    18: "Fs0.mp3",
    21: "A0.mp3",
    24: "C1.mp3",
    "D#1": "Ds1.mp3",
    "F#1": "Fs1.mp3",
    A1: "A1.mp3",
    36: "C2.mp3",
    "D#2": "Ds2.mp3",
    "F#2": "Fs2.mp3",
    A2: "A2.mp3",
    C3: "C3.mp3",
    "D#3": "Ds3.mp3",
    "F#3": "Fs3.mp3",
    A3: "A3.mp3",
    C4: "C4.mp3",
    "D#4": "Ds4.mp3",
    "F#4": "Fs4.mp3",
    A4: "A4.mp3",
    C5: "C5.mp3",
    "D#5": "Ds5.mp3",
    "F#5": "Fs5.mp3",
    A5: "A5.mp3",
    C6: "C6.mp3",
    "D#6": "Ds6.mp3",
    "F#6": "Fs6.mp3",
    A6: "A6.mp3",
  },
  release: 1,
  baseUrl: "/sounds/piano/",
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

  // David wanted the second arm to be played from high to low but from middle to edge.
  // This is not possible with the way the galaxy points are designed, so we manually reverse the second arm's notes during playback only.
  const note = convertNote(
    notes[arm === 1 ? index : notes.length - 1 - index],
    constants.C_MAJOR_SCALE,
  );
  piano.triggerAttackRelease(note, 1, Tone.now());
}

/** The galaxy gives one point per eighth note; features are what turn them into longer notes. */
function toNotes(midiNotes: number[]): Note[] {
  return midiNotes.map((midi) => ({ midi, length: 1 }));
}

/**
 * @param equation The slider values to write into the equation on the plot page. They are passed
 * in rather than read from `state`, because `state` imports from this module.
 */
export async function exportPdf(equation: EquationParams) {
  // The title box is only read here, at export time — nothing before this point cares about it.
  const titleInput = document.getElementById("compositionTitle") as HTMLInputElement | null;
  TEMPLATE_DATA.title = titleInput?.value.trim() || "Anonymous";

  const xml = populateComposition(
    TEMPLATE_XML,
    TEMPLATE_DATA,
    toNotes(arm1),
    toNotes(arm2.toReversed()), // reverse the arm2 for contrary motion
  );

  // downloadFile(new TextEncoder().encode(formatXml(xml)), "galaxy.musicxml", "application/xml");
  const pdfData = await renderPdfFromXML(xml);
  // The score ends with a picture of the galaxy it was generated from, and the equation behind it.
  const withPlot = await appendPlotPage(pdfData, capturePlot(), equation);
  downloadFile(withPlot, "galaxy.pdf", "application/pdf");
}

/**
 * The plot canvas as a PNG data URL. This reads the WebGL buffer back, which only works because
 * `main.ts` initialises the Pixi renderer with `preserveDrawingBuffer`.
 */
function capturePlot(): string {
  const plot = document.getElementById("plot") as HTMLCanvasElement | null;
  if (!plot) throw new Error("Missing plot canvas: #plot");
  return plot.toDataURL("image/png");
}

export const indicies = [[], []] as [(number | null)[], (number | null)[]];

const TEMPLATE_XML = await fetchText("/templates/template-2.musicxml");
const TEMPLATE_DATA = JSON.parse(await fetchText("/templates/template-2.json")) as TemplateData;

// @ts-ignore
globalThis.exportMidi = () => {
  const midi = generateMidiFile(
    [
      arm1.map((note) => ({ note: adjustNoteToScale(note, constants.C_MAJOR_SCALE), duration: 1 })),
      arm2
        .map((note) => ({ note: adjustNoteToScale(note, constants.C_MAJOR_SCALE), duration: 1 }))
        .reverse(),
    ],
    { names: ["Arm 1", "Arm 2"], bpm: 120, npb: 2 },
  );

  const patched = patchKeySignature(midi.toArray() as Uint8Array<ArrayBuffer>);

  downloadFile(patched, "galaxy.mid", "audio/midi");
};
