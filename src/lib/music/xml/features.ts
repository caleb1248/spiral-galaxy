// See features.md to learn how "features" behave here.

import type { Note } from "../../types";
import { findNearest, scale } from "../../utils";
import { constants } from "../constants";
import { isExpressibleDuration } from "./durations";
import { removeChildren } from "./elements";

/** What a feature knows about the insertion it is being applied to. */
export interface NoteArrayContext {
  /** Eighth notes per measure, from the template data. */
  notesPerMeasure: number;
}

/** What a feature knows about the note element it is being handed. */
export interface NoteElementContext {
  /** The note data that was just written into the element. */
  note: Note;
  /** Where the note starts within its measure, counted in eighth notes. */
  offsetInMeasure: number;
  /** The measure's number in the composition. */
  measureNumber: number;
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

/**
 * Replaces notes at the specified positions with rests.
 * @param positions The indicies of the notes to convert to rests, counted in eighth notes from the start of the insertion.
 *
 */
function omit(positions: number[]): Feature {
  return {
    handleNoteArray(notes) {
      let offset = 0;

      for (const note of notes) {
        if (positions.includes(offset)) note.midi = null;
        offset += note.duration;
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

function duplicateNotes(behavior: "extend" | "remove"): Feature {
  return {
    handleNoteArray(notes, { notesPerMeasure }): void {
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

      // "extend": absorb each run of repeated notes into the first note of the run, so the run
      // is written as one longer note instead of the same pitch struck several times.
      let offsetInMeasure = 0;

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];

        while (i + 1 < notes.length && notes[i + 1].midi === note.midi) {
          const merged = note.duration + notes[i + 1].duration;

          // A note may not run past the barline, because carrying it over would need a tie, and
          // it has to stay a duration that a single note head can express.
          if (offsetInMeasure + merged > notesPerMeasure) break;
          if (!isExpressibleDuration(merged)) break;

          note.duration = merged;
          notes.splice(i + 1, 1);
        }

        offsetInMeasure = (offsetInMeasure + note.duration) % notesPerMeasure;
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
  const unPaddedScale = scale.slice(1, -1); // The scale is padded around the ends to make rounding easier.

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
  /** Positions to turn into rests, in eighth notes from the start of the insertion. */
  omit?: number[];
  /** Midi range to fit the snippet's pitches into. */
  range?: { low: number; high: number };
  duplicateNotes?: "extend" | "remove";
  keySignature?: number | { fifths: number; round?: boolean };
}

const featureFactories = {
  omit,
  range,
  duplicateNotes,
  keySignature,
} satisfies { [K in keyof FeaturesConfig]-?: (value: NonNullable<FeaturesConfig[K]>) => Feature };

/** The features should run in this order. */
const featureOrder = ["omit", "range", "keySignature", "duplicateNotes"] as const;

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
    handlers.push((featureFactories[name] as (value: unknown) => Feature)(value));
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
