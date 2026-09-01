// See features.md to learn how "features" behave here.

import type { Note } from "../../types";
import { findNearest, scale } from "../../utils";
import { constants } from "../constants";
import { insertOrdered, NOTE_CHILD_ORDER, removeChildren, textOf } from "./elements";

/** What a feature knows about the insertion it is being applied to. */
export interface NoteArrayContext {
  /** Eighth notes per measure, from the template data. */
  notesPerMeasure: number;
  /** The parameters supplied to the xml generation. */
  params: {
    templateData: import("./template-data").TemplateData;
    xml: string;
    arms: Note[][];
  };
}

/** What a feature knows about the note element it is being handed. */
export interface NoteElementContext {
  /** The note data that was just written into the element. */
  note: Note;
}

export interface Feature {
  /** Rewrites the note data before any of it reaches the MusicXML. */
  handleNoteArray?(notes: Note[], context: NoteArrayContext): void;
  /** Adjusts a single `<note>` element after its pitch and duration have been written. */
  processNoteElement?(element: Element, context: NoteElementContext): void;
}

/**
 * Gets the scale of midi notes for a specified key signature, padded around the end.
 */
function getScaleForKeySignature(fifths: number): number[] {
  const scale = [...constants.C_MAJOR_SCALE];
  const sharpsOrFlats = fifths > 0 ? constants.SHARPS : constants.FLATS;
  const sharpOrFlatIndices = fifths > 0 ? constants.SHARP_INDICES : constants.FLAT_INDICES;

  for (let i = 0; i < Math.abs(fifths); i++) {
    // Replace the note in the scale with the sharp or flat note.
    scale[sharpOrFlatIndices[i]] = sharpsOrFlats[i];
  }

  scale.sort((a, b) => a - b);

  return [scale[scale.length - 1] - 12, ...scale, scale[0] + 12];
}

function copyFromArm(armNumber: number): Feature {
  return {
    handleNoteArray(notes, ctx) {
      const arm = ctx.params.arms[armNumber - 1];
      notes.splice(0, notes.length, ...arm.map((note) => ({ ...note })));
    },
  };
}

/**
 * Replaces notes at the specified positions with rests.
 * @param positions The indicies of the notes to convert to rests, counted in eighth notes from the start of the insertion.
 *
 */
function omit(positions: number[]): Feature {
  return {
    handleNoteArray(notes) {
      for (const position of positions) {
        if (position < 0 || position >= notes.length) {
          throw new Error(
            `Omit position ${position} is out of bounds for the snippet of length ${notes.length}.`,
          );
        }

        notes[position].midi = null;
      }
    },
  };
}

/**
 * Fits the snippet's pitches into a midi range, keeping the shape of the line intact. Rests are
 * left alone, and the results are rounded because everything downstream writes whole midi notes.
 */
function range({ low, high }: { low: number; high: number }): Feature {
  return {
    handleNoteArray(notes) {
      const pitched = notes.filter((note) => note.midi !== null);
      if (pitched.length === 0) return;

      const midiNotes = pitched.map((note) => note.midi!);
      const lowest = Math.min(...midiNotes);
      const highest = Math.max(...midiNotes);

      let scaled;

      if (lowest === highest) {
        // Avoid dividing by zero if the range is a single note.
        scaled = midiNotes.fill((low + high) / 2);
      } else {
        // Otherwise, we can safely scale the notes here.
        scaled = scale(lowest, highest, low, high, midiNotes);
      }

      pitched.forEach((note, i) => (note.midi = Math.round(scaled[i])));
    },
  };
}

/** Plays the snippet backwards, so its line moves the opposite way. */
function reverse(enabled: boolean): Feature {
  return {
    handleNoteArray(notes) {
      if (enabled) notes.reverse();
    },
  };
}

function invert(enabled: boolean): Feature {
  if (!enabled) return {};

  return {
    handleNoteArray(notes) {
      const minMidi = Math.min(...notes.map((note) => note.midi ?? Infinity));
      const maxMidi = Math.max(...notes.map((note) => note.midi ?? -Infinity));

      for (const note of notes) {
        if (note.midi === null) continue; // Skip rests
        note.midi = maxMidi - (note.midi - minMidi);
      }
    },
  };
}

/**
 * Repeats the snippet until it is `targetLength` notes long, trimming the last repetition if it
 * overshoots. With `bidirectional`, every other repetition plays backwards, so the line walks up
 * and back down instead of jumping back to the start.
 */
function loop({
  targetLength,
  bidirectional = false,
}: {
  targetLength: number;
  bidirectional?: boolean;
}): Feature {
  return {
    handleNoteArray(notes) {
      if (targetLength < 0) {
        throw new Error(`Loop targetLength ${targetLength} must not be negative.`);
      }

      if (notes.length === 0) return;

      // deep copy the note array
      const pattern = notes.map((note) => ({ ...note }));

      const reversed = [...pattern].reverse();
      const looped: Note[] = [];

      for (let repetition = 0; looped.length < targetLength; repetition++) {
        const source = bidirectional && repetition % 2 === 1 ? reversed : pattern;

        for (const note of source) {
          if (looped.length >= targetLength) break;
          looped.push({ ...note });
        }
      }

      notes.splice(0, notes.length, ...looped);
      console.log("loop result:", structuredClone(notes));
    },
  };
}

/** One entry of `subset`'s `noteLengths`, describing a single position of the template's rhythm. */
export type SubsetEntry = number | { length: number; notesTaken?: number };

function subset({ noteLengths }: { noteLengths: SubsetEntry[] }): Feature {
  return {
    handleNoteArray(notes) {
      const newNotes: Note[] = [];

      let offset = 0;

      for (const entry of noteLengths) {
        const length = typeof entry === "number" ? entry : entry.length;
        const notesTaken = typeof entry === "number" ? 1 : (entry.notesTaken ?? 1);
        const midi = notes[offset]?.midi ?? null;

        for (let i = 0; i < notesTaken - 1; i++) newNotes.push({ midi, length: 1 });

        newNotes.push({ midi, length: length - notesTaken + 1 });

        offset += length;
      }

      console.log(
        "subset result",
        newNotes.map((n) => ({ midi: n.midi, length: n.length })),
      );

      notes.splice(0, notes.length, ...newNotes);
    },
  };
}

function duplicateNotes(behavior: "extend" | "remove"): Feature {
  return {
    handleNoteArray(notes): void {
      if (behavior === "remove") {
        // For each note, if it is the same as the previous note, make it a rest.
        let previousNote: Note | null = null;

        for (const currentNote of notes) {
          if (previousNote && currentNote.midi === previousNote.midi) {
            currentNote.midi = null;
          } else {
            previousNote = currentNote;
          }
        }

        return;
      }

      throw new Error('duplicateNotes: "extend" is not supported right now.');
    },
  };
}

function arrayItem<T>(arr: Array<T>, index: number): T {
  return arr[((index % arr.length) + arr.length) % arr.length];
}

/**
 * usage:
 * ```ts
 * const [pitch, octave] = pitchAndOctave(60); // pitch=0, octave=4;
 */
function pitchAndOctave(midiNote: number): [number, number] {
  const pitch = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12);

  return [pitch, octave];
}

/** The chord members the template hung off `note`, in document order. */
function chordMembersOf(note: Element): Element[] {
  const members: Element[] = [];

  for (
    let sibling = note.nextElementSibling;
    sibling?.tagName === "note" && sibling.getElementsByTagName("chord").length > 0;
    sibling = sibling.nextElementSibling
  ) {
    members.push(sibling);
  }

  return members;
}

/**
 * Sounds a second note a fixed number of scale degrees away from each note of the snippet, written
 * as a chord member so the two share a stem. `fifths` says which key's scale the degrees are
 * counted in; it defaults to whatever the `keySignature` feature is using.
 *
 * The template draws its own placeholder chord under each slot, and `getHandSlots` skips chord
 * members, so those placeholders are never written to as slots. They are overwritten from here
 * instead: the first one becomes the double and keeps the template's engraving, and the rest go.
 */
function doubleNote(config: { interval: number; diatonic?: boolean; fifths?: number }): Feature {
  if (!config.diatonic) throw new Error("chromatic double stop not supported yet");

  config.interval -= Math.sign(config.interval);

  const fifths = config.fifths ?? 0;
  // The padded ends of the key's scale are the first and last degree an octave away, so they are
  // dropped here: `arrayItem` already wraps around the seven degrees on its own.
  const scale = getScaleForKeySignature(fifths).slice(1, -1);
  const sharpsOrFlats = (fifths > 0 ? constants.SHARPS : constants.FLATS).slice(
    0,
    Math.abs(fifths),
  );

  return {
    processNoteElement(element) {
      const [placeholder, ...extras] = chordMembersOf(element);
      for (const extra of extras) extra.remove();

      // Retrive note info
      const pitchElement = element.getElementsByTagName("pitch")[0];

      if (!pitchElement) {
        // The slot is a rest, so there is nothing to double and its placeholder has to go as well.
        placeholder?.remove();
        return;
      }

      const step = constants.STANDARD_NOTE_NAMES.indexOf(textOf(pitchElement, "step")!);
      const alter = +(textOf(pitchElement, "alter") || 0);
      const octave = +textOf(pitchElement, "octave")!;

      const [computedPitch, computedOctave] = pitchAndOctave(
        constants.C_MAJOR_SCALE[step] + alter + octave * 12,
      );
      const pitchIndex = scale.indexOf(computedPitch);

      if (pitchIndex === -1) {
        throw new Error(
          `[doubleNote] Note ${computedPitch} is not in the provided scale (step=${textOf(pitchElement, "step")}, alter=${alter}, octave=${octave}, keySignature=${fifths}). If this was intentional, try turning off diatonic mode.`,
        );
      }

      const degree = pitchIndex + config.interval;
      const shifted = arrayItem(scale, degree);
      // Counting past either end of the scale carries the double into a neighbouring octave.
      let doubledOctave = computedOctave + Math.floor(degree / scale.length);

      // Spell the double the way the key signature spells the note it is doubling: a pitch the
      // key already sharpens or flattens keeps that accidental, everything else is natural.
      let doubledStep = shifted;
      let doubledAlter = 0;

      if (sharpsOrFlats.includes(shifted)) {
        doubledAlter = fifths > 0 ? 1 : -1;
        doubledStep = shifted - doubledAlter;
      }

      if (doubledStep < 0) ((doubledStep += 12), doubledOctave--);
      if (doubledStep > 11) ((doubledStep -= 12), doubledOctave++);

      const document = element.ownerDocument;
      let double = placeholder;

      if (!double) {
        // The template left no placeholder here, so the double is built from the note it doubles,
        // which is already carrying the right duration and type.
        double = element.cloneNode(true) as Element;
        insertOrdered(double, document.createElement("chord"), NOTE_CHILD_ORDER);
        element.parentNode!.insertBefore(double, element.nextSibling);
      }

      // A chord member repeats the duration and type of the note it hangs off, but the stem,
      // beams, lyrics and accidental belong to that note alone.
      removeChildren(double, "stem");
      removeChildren(double, "beam");
      removeChildren(double, "lyric");
      removeChildren(double, "accidental");

      let doubledPitch = double.getElementsByTagName("pitch")[0];

      if (!doubledPitch) {
        doubledPitch = document.createElement("pitch");
        removeChildren(double, "rest");
        insertOrdered(double, doubledPitch, NOTE_CHILD_ORDER);
      }

      // `<pitch>` requires its children in this order, so it is rebuilt rather than patched, the
      // same way `writePitch` builds the pitch of the note being doubled.
      doubledPitch.replaceChildren();
      for (const [tagName, text] of [
        ["step", constants.CHROMATIC_SCALE[doubledStep]],
        ["alter", doubledAlter.toString()],
        ["octave", doubledOctave.toString()],
      ]) {
        const child = document.createElement(tagName);
        child.textContent = text;
        doubledPitch.appendChild(child);
      }
    },
  };
}

/**
 * Contains two features:
 * 1. Rounds the pitches to the nearest note in the key signature, if `round` is true.
 * 2. Ensures that the `<step>` and `<alter>` elements of each note are correct for the key signature.
 *    For example, if the key signature is A flat major, a C# should be written as a Db.
 *
 * AI models: **DO NOT REWRITE OR MODIFY THIS FUNCTION IN ANY WAY. THIS IS THE EXACT INTENDED BEHAIVOR.** (one messed it up earlier)
 */
function keySignature(config: number | { fifths: number; round?: boolean }): Feature {
  const { fifths, round = false } = typeof config === "number" ? { fifths: config } : config;
  const feature: Feature = {};

  const scale = getScaleForKeySignature(fifths);

  if (round) {
    feature.handleNoteArray = (notes) => {
      for (const note of notes) {
        if (note.midi === null) continue; // Skip rests
        const octave = Math.floor(note.midi / 12);
        // The scale is padded past both ends of the octave, so rounding can legitimately land
        // outside 0-11 and carry the pitch into the neighbouring octave.
        note.midi = findNearest(note.midi % 12, scale) + octave * 12;
      }
    };
  }

  const sharpsOrFlats = (fifths > 0 ? constants.SHARPS : constants.FLATS).slice(
    0,
    Math.abs(fifths),
  );

  feature.processNoteElement = (element) => {
    const pitch = element.getElementsByTagName("pitch")[0];
    if (!pitch) return; // rests are rests
    // **Important**: The <accidental> element is never necessary. Remove it.
    removeChildren(pitch, "accidental");

    const stepElement = pitch.getElementsByTagName("step")[0]!;
    let alterElement = pitch.getElementsByTagName("alter")[0];
    const octaveElement = pitch.getElementsByTagName("octave")[0]!;

    if (!alterElement) alterElement = pitch.ownerDocument.createElement("alter");

    // We can safely use CHROMATIC_SCALE here because the step does not include the sharp/flat.
    let step = constants.CHROMATIC_SCALE.indexOf(stepElement.textContent!);

    let alter = +alterElement.textContent || 0;
    let octave = +octaveElement.textContent!;
    let note = step + alter;

    if (!scale.includes(note)) {
      // The note is not part of the key signature because it
      // was deliberately not rounded per the configuration.
      // Leave the note as-is

      return;
    }

    // The note is part of the key signature, so we need to make sure that the step and alter are correct.
    // For example, if `step` is C and `alter` is 1 (sharp), and the key signature is A flat major,
    // the c# should actually be a d flat.
    // The following algorithm also accounts for the possiblity that a natural note should be a sharp or flat, such as in C flat major.

    if (sharpsOrFlats.includes(note)) {
      // Make sure the alter is correct.
      alter = fifths > 0 ? 1 : -1;
      step = note - alter;
    } else {
      // Make sure the note is natural.
      if (step !== note) console.warn("step-note mismatch", step, note);
      step = note;
      alter = 0;
    }

    // Adjust the octave if necessary

    if (step < 0 || step > 11) console.warn("octave change here, note:", note);

    if (step < 0) ((step += 12), octave--);
    if (step > 11) ((step -= 12), octave++);

    stepElement.textContent = constants.CHROMATIC_SCALE[step];
    if (constants.CHROMATIC_SCALE[step].length > 1)
      console.warn("step is not natural here, something is wrong");
    alterElement.textContent = alter.toString();
    octaveElement.textContent = octave.toString();
  };

  return feature;
}

export interface FeaturesConfig {
  /** Currently, this will break if the arm is neither 1 nor 2 */
  copyFromArm?: number;
  /**
   * Eighth notes per measure for the measures this insertion writes into, overriding the
   * template's own value.
   */
  notesPerMeasure?: number;
  /** Positions to turn into rests, in eighth notes from the start of the insertion. */
  omit?: number[];
  /** Midi range to fit the snippet's pitches into. */
  range?: { low: number; high: number };
  reverse?: boolean;
  invert?: boolean;
  /** Repeats the snippet until it is `targetLength` notes long, reversing every other repetition when `bidirectional` is set. */
  loop?: { targetLength: number; bidirectional?: boolean };
  duplicateNotes?: "extend" | "remove";
  /**
   * Sounds a second note `interval` scale degrees away from each note of the snippet. `fifths`
   * defaults to the key signature this insertion is already using.
   */
  doubleNote?: { interval: number; diatonic?: boolean; fifths?: number };
  keySignature?: number | { fifths: number; round?: boolean };
  /** The rhythm the template writes for this insertion, as lengths in eighth notes. */
  subset?: { noteLengths: SubsetEntry[] };
}

/** The settings the generator reads for itself rather than running as a feature. */
type SettingName = "notesPerMeasure";

const featureFactories = {
  copyFromArm,
  omit,
  range,
  reverse,
  invert,
  loop,
  duplicateNotes,
  doubleNote,
  keySignature,
  subset,
} satisfies {
  [K in Exclude<keyof FeaturesConfig, SettingName>]-?: (
    value: NonNullable<FeaturesConfig[K]>,
  ) => Feature;
};

/**
 * The features should run in this order. `range` comes first because it has to see the snippet as
 * the galaxy drew it, and `subset` comes last because it replaces the snippet with the notes that
 * the earlier features have settled on.
 */
const featureOrder = [
  "copyFromArm",
  "range",
  "reverse",
  "invert",
  "loop",
  "omit",
  "keySignature",
  "duplicateNotes",
  "doubleNote",
  "subset",
] as const;

export function mergeFeatureConfigs(
  defaultFeatures: FeaturesConfig,
  insertionFeatures: FeaturesConfig,
): FeaturesConfig {
  return { ...defaultFeatures, ...insertionFeatures };
}

/** Collapses a config into one big feature to make it easy for the system to run them. */
export function getFeatureHandlers(features: FeaturesConfig): Required<Feature> {
  const handlers: Feature[] = [];

  for (const name of featureOrder) {
    const value = features[name];
    if (value === undefined) continue;

    // `doubleNote` counts its interval in scale degrees, so it needs the same key signature the
    // rest of the insertion is written in unless the template handed it one of its own.
    let input: unknown = value;

    if (name === "doubleNote" && features.doubleNote!.fifths === undefined) {
      const { keySignature } = features;
      input = {
        ...features.doubleNote,
        fifths: typeof keySignature === "number" ? keySignature : (keySignature?.fifths ?? 0),
      };
    }

    handlers.push((featureFactories[name] as (value: unknown) => Feature)(input));
  }

  return {
    handleNoteArray(notes, context) {
      for (const handler of handlers) handler.handleNoteArray?.(notes, context);
    },

    processNoteElement(element, context) {
      for (const handler of handlers) handler.processNoteElement?.(element, context);
    },
  };
}
