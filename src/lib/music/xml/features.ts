// See features.md to learn how "features" behave here.

import type { Note } from "../../types";
import { findNearest } from "../../utils";
import { constants } from "../constants";

export interface Feature {
  handleNoteArray?(notes: Note[]): void;
  processNoteElement?(note: Element): void;
}

function getScaleForKeySignature(fifths: number): number[] {
  if (fifths === 0) return constants.C_MAJOR_SCALE;
  const scale = [...constants.C_MAJOR_SCALE];
  const sharpsOrFlats = fifths > 0 ? constants.SHARPS : constants.FLATS;
  const sharpOrFlatIndices = fifths > 0 ? constants.SHARP_INDICES : constants.FLAT_INDICES;

  for (let i = 0; i < Math.abs(fifths); i++) {
    // Replace the note in the scale with the sharp or flat note.
    scale[sharpOrFlatIndices[i]] = sharpsOrFlats[i];
  }

  scale.unshift(scale[scale.length - 1] - 12); // Add the last note of the scale in the previous octave to the beginning of the scale.
  scale.push(scale[0] + 12); // Add the first note of the scale in the next octave to the end of the scale.

  return scale;
}

function duplicateNotes(behavior: "extend" | "remove"): Feature {
  return {
    handleNoteArray(notes): void {
      if (behavior === "extend") {
        // If a note is a duplicate, extend the duration of the previous note and delete the current note.
        let previousNote: Note | null = null;
        for (let i = 0; i < notes.length; i++) {
          const currentNote = notes[i];
          if (previousNote && currentNote.midi === previousNote.midi) {
            previousNote.duration += currentNote.duration;
            notes.splice(i, 1);
            i--; // Adjust index after removal
          } else {
            previousNote = currentNote;
          }
        }
      } else if (behavior === "remove") {
        // For each note, if it is the same as the previous note, make it a rest.
        let previousNote: Note | null = null;

        for (let i = 0; i < notes.length; i++) {
          const currentNote = notes[i];

          if (previousNote && currentNote.midi === previousNote.midi) {
            currentNote.midi = null;
          } else {
            previousNote = currentNote;
          }
        }
      }
    },
  };
}

/** Rounds each note to the nearest note in the key signature */
function keySignature(keySignatureFifths: number | { fifths: number; round?: boolean }): Feature {
  const options =
    typeof keySignatureFifths === "number" ? { fifths: keySignatureFifths } : keySignatureFifths;
  const { fifths, round = false } = options;

  // Rounding feature
  const roundingFeature: Feature = {
    handleNoteArray(notes) {
      const scale = getScaleForKeySignature(fifths);

      for (const note of notes) {
        if (!note.midi) continue; // Skip rests
        const octave = Math.floor(note.midi / 12);
        const noteInOctave = note.midi % 12;
        const nearestNoteInScale = findNearest(noteInOctave, scale);
        note.midi = nearestNoteInScale + octave * 12;
      }
    },
  };

  // Accidental feature
  const scale = getScaleForKeySignature(fifths);
  const sharpsOrFlats = (fifths > 0 ? constants.SHARPS : constants.FLATS).slice(
    0,
    Math.abs(fifths),
  );
  const naturals = scale.filter((note) => !sharpsOrFlats.includes(note));

  const accidentalFeature: Feature = {
    processNoteElement(note) {
      const pitch = note.querySelector("pitch");
      if (!pitch) return;

      const stepElement = pitch.querySelector("step");
      const alterElement = pitch.querySelector("alter");
      const octaveElement = pitch.querySelector("octave");

      if (!stepElement || !alterElement || !octaveElement) return;

      // Calculate midi note from step, alter, and octave
      const step = constants.CHROMATIC_SCALE.indexOf(stepElement.textContent);
      let alter = parseInt(alterElement.textContent || "0", 10);
      let octave = parseInt(octaveElement.textContent || "0", 10);

      let midiNote = step + alter + octave * 12;

      if (!scale.includes(midiNote % 12)) return; // The note is not in the key signature, preserve the accidental.

      if (naturals.includes(midiNote % 12)) {
        alter = 0;
      } else {
        // The note should be a sharp or flat since it is not a natural.
        alter = fifths > 0 ? 1 : -1;
      }

      // Update the alter element with the new value
      alterElement.textContent = alter.toString();
      midiNote -= alter; // the alter has already been written, so we subtract the midinote by the alter to get the correct midi note.
      stepElement.textContent = constants.CHROMATIC_SCALE[midiNote % 12]; // We can guarantee that there is no sharp or flat here.
      octaveElement.textContent = Math.floor(midiNote / 12).toString(); // Update the octave in case it got changed.
    },
  };

  return {
    ...accidentalFeature,
    ...(round ? roundingFeature : {}),
  };
}

export interface FeaturesConfig {
  duplicateNotes?: "extend" | "remove";
  keySignature?: number | { fifths: number; round?: boolean };
}

const currentFeatureSet = {
  duplicateNotes,
  keySignature,
} as Record<string, (...args: any) => Feature>;

export function mergeFeatureConfigs(
  defaultFeatures: FeaturesConfig,
  insertionFeatures: FeaturesConfig,
): FeaturesConfig {
  return { ...defaultFeatures, ...insertionFeatures };
}

export const getFeatureHandlers = (features: FeaturesConfig): Feature => {
  const handlers: Feature[] = [];
  for (const [featureName, featureValue] of Object.entries(features)) {
    const featureHandlerFactory = currentFeatureSet[featureName];
    if (featureHandlerFactory) {
      handlers.push(featureHandlerFactory(featureValue));
    }
  }

  return {
    handleNoteArray(notes) {
      for (const handler of handlers) {
        if (handler.handleNoteArray) {
          handler.handleNoteArray(notes);
        }
      }
    },

    processNoteElement(note) {
      for (const handler of handlers) {
        if (handler.processNoteElement) {
          handler.processNoteElement(note);
        }
      }
    },
  };
};
