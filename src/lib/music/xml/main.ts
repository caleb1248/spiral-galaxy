import type { TemplateData } from "./template-data";
import { constants } from "../constants";
import type { Note } from "../../types";
import { getFeatureHandlers, mergeFeatureConfigs, type Feature } from "./features";
import { isRest, removeChildren, textOf } from "./elements";

const parser = new DOMParser();

/** `<divisions>` counts per quarter note, while the note durations here count eighth notes. */
const EIGHTHS_PER_QUARTER = 2;

/**
 * Inserts the galaxy snippets into the provided template composition
 * @param xml The template composition in MusicXML format
 * @param templateData Contains information on where to insert the galaxy snippets into the template composition
 * @param arm1 The galaxy snippet for the right hand
 * @param arm2 The galaxy snippet for the left hand
 * @returns The completed composition in MusicXML format
 */
export function populateComposition(
  xml: string,
  templateData: TemplateData,
  arm1: Note[],
  arm2: Note[],
): string {
  const composition = parser.parseFromString(xml, "application/xml");
  const parseError = composition.getElementsByTagName("parsererror")[0];
  if (parseError) throw new Error(`Template is not valid XML: ${parseError.textContent}`);

  const { insertions, defaultFeatures = {} } = templateData;
  const divisionsPerEighth = getDivisionsPerEighth(composition);

  for (const insertion of insertions) {
    // Each insertion works on its own copy, because features rewrite the array in place and
    // several insertions replay the same arm.
    const notes: Note[] = (insertion.hand === "right" ? arm1 : arm2).map((note) => ({
      ...note,
      midi: note.midi === null ? null : Math.round(note.midi),
    }));

    const config = mergeFeatureConfigs(defaultFeatures, insertion.features ?? {});
    const notesPerMeasure = config.notesPerMeasure ?? templateData.notesPerMeasure;

    if (notesPerMeasure === undefined) {
      throw new Error(
        `The insertion at measure ${insertion.measure} has no notesPerMeasure, and the template ` +
          `does not give one either.`,
      );
    }

    // `subset` picks its notes to match the rhythm the template already writes, so the durations
    // in the template are the ones to keep.
    const preserveTemplateRhythm = config.subset !== undefined;
    const features = getFeatureHandlers(config);

    console.log("working on", insertion.measure);

    features.handleNoteArray(notes, {
      notesPerMeasure,
      params: { xml, templateData, arms: [arm1, arm2] },
    });

    let measureNumber = insertion.measure;

    for (const measureNotes of splitIntoMeasures(notes, notesPerMeasure)) {
      const measure = composition.querySelector(`measure[number="${measureNumber}"]`);
      if (!measure) throw new Error(`Measure ${measureNumber} not found in composition.`);

      populateMeasure(measure, measureNotes, {
        hand: insertion.hand,
        measureNumber,
        divisionsPerEighth,
        features,
        preserveTemplateRhythm,
      });

      measureNumber++;
    }
  }

  finalizeComposition(composition);

  return new XMLSerializer().serializeToString(composition);
}

/** How many `<duration>` units one eighth note is worth in this composition. */
function getDivisionsPerEighth(composition: Document): number {
  const divisions = Number(textOf(composition.documentElement, "divisions"));

  if (!Number.isInteger(divisions) || divisions <= 0) {
    throw new Error("Template is missing a valid <divisions> value.");
  }

  if (divisions % EIGHTHS_PER_QUARTER !== 0) {
    throw new Error(`Template <divisions> of ${divisions} cannot express an eighth note.`);
  }

  return divisions / EIGHTHS_PER_QUARTER;
}

/**
 * Groups the notes into measures by their total duration rather than by how many there are, so
 * that a measure still holds `notesPerMeasure` eighth notes' worth of music after features have
 * merged notes into longer ones. A leftover partial measure at the end is returned as-is; the
 * slots it does not reach keep whatever the template put there.
 */
function splitIntoMeasures(notes: Note[], notesPerMeasure: number): Note[][] {
  console.log("notes per measure:", notesPerMeasure);
  const measures: Note[][] = [];
  let currentMeasure: Note[] = [];
  let currentOffset = 0;

  for (let i = 0; i < notes.length; ) {
    console.log("i=" + i);
    const note = notes[i];
    currentMeasure.push(note);
    currentOffset += note.length;

    i++;

    if (currentOffset > notesPerMeasure) {
      console.warn("existing measures:", measures);
      throw new Error(
        `The notes for measure ${measures.length + 1} exceed the expected length of ` +
          `${notesPerMeasure} eighth notes. Check the subset feature to make sure the noteLengths add up to notesPerMeasure for each measure. The current measure is ${JSON.stringify(
            currentMeasure.map((v) => v.length),
            null,
            2,
          )}`,
      );
    }

    if (currentOffset === notesPerMeasure) {
      // Start a new measure if necessary.
      measures.push(currentMeasure);
      currentMeasure = [];
      currentOffset = 0;
    }
  }

  // If the last meausure is not full, it doesn't get pushed inside the for loop, so add it here.
  if (currentMeasure.length > 0) measures.push(currentMeasure);

  console.log("measure split result", measures);

  return measures;
}

interface MeasureOptions {
  hand: "right" | "left";
  measureNumber: number;
  divisionsPerEighth: number;
  features: Required<Feature>;
  /** Whether the notes are written to the rhythm the template already carries. */
  preserveTemplateRhythm: boolean;
}

/** writes a 1-measure section of a snippet*/
function populateMeasure(measure: Element, notes: Note[], options: MeasureOptions) {
  console.log("populating measure", options.measureNumber);
  const { hand, measureNumber, features } = options;
  const slots = getHandSlots(measure, options);
  console.log("notes", notes, "slots.length", slots.length);

  if (notes.length > slots.length) {
    throw new Error(
      `Measure ${measureNumber} does not have enough ${hand}-hand slots to fill the current snippet (slots.length=${slots.length}, notes.length=${notes.length}).`,
    );
  }

  for (let i = 0; i < notes.length; i++) {
    // writeNote(slots[i], notes[i]);
    console.log(options.hand);
    if (options.hand === "left") {
      writeNote(slots[i], {
        ...notes[i],
        midi: notes[i].midi === null ? null : notes[i].midi,
      });
    } else {
      writeNote(slots[i], notes[i]);
    }
  }

  for (let i = 0; i < notes.length; i++) {
    features.processNoteElement(slots[i], { note: notes[i] });
  }

  normalizeBeams(slots);
}

/**
 * The note elements an insertion may overwrite in one measure: the eighth-note slots on the
 * staff belonging to `hand`, in the first voice found on that staff. Chord members are skipped
 * because they share the slot of the note they follow, and the other voices are accompaniment
 * that the template owns.
 *
 * The slots have to be plain eighth notes for the rhythm to be rewritten, but an insertion that
 * keeps the template's rhythm takes them however the template wrote them.
 */
function getHandSlots(measure: Element, options: MeasureOptions): Element[] {
  const { hand } = options;
  const staff = hand === "right" ? "1" : "2";

  const onStaff = Array.from(measure.getElementsByTagName("note")).filter(
    (note) => textOf(note, "staff") === staff && note.getElementsByTagName("chord").length === 0,
  );

  const voice = textOf(onStaff[0], "voice");
  const slots = onStaff.filter(
    (note) => textOf(note, "voice") === voice || note.getElementsByTagName("rest").length > 0,
  );

  if (options.preserveTemplateRhythm) return slots;

  return slots;
}

/**
 * Rebuilds the beams across a measure's slots. Only a surviving eighth note that is not a rest
 * can carry a beam, so merging notes together or silencing them splits the template's groups
 * apart. Each remaining run of two or more beamable slots gets a fresh begin/continue/end, and
 * anything left on its own is unbeamed.
 */
function normalizeBeams(slots: Element[]) {
  // not implemented for now.
}

/** Replaces the contents of a template slot with `note`. */
function writeNote(element: Element, note: Note): void {
  if (note.midi === null) writeRest(element);
  else writePitch(element, note.midi);
}

/** Turns a slot into a rest, dropping the markup that only makes sense on a sounding note. */
function writeRest(element: Element): void {
  const pitch = element.getElementsByTagName("pitch")[0];
  if (pitch) pitch.replaceWith(element.ownerDocument.createElement("rest"));
  else if (!isRest(element)) {
    const rest = element.ownerDocument.createElement("rest");
    element.insertBefore(rest, element.firstChild);
  }

  removeChildren(element, "accidental");
  removeChildren(element, "stem");
  removeChildren(element, "articulations");

  for (const notations of Array.from(element.getElementsByTagName("notations"))) {
    if (notations.children.length === 0) notations.remove();
  }
}

/**
 * Writes a midi note into a slot's `<pitch>`. Black keys are always spelled as sharps here; the
 * `keySignature` feature respells them for flat keys afterwards.
 */
function writePitch(element: Element, midi: number): void {
  const document = element.ownerDocument;
  const pitchClass = midi % 12;
  const isNatural = constants.C_MAJOR_SCALE.includes(pitchClass);

  const alter = isNatural ? 0 : 1;
  const step = constants.CHROMATIC_SCALE[pitchClass - alter].toUpperCase();
  const octave = Math.floor(midi / 12);

  let pitch = element.getElementsByTagName("pitch")[0];

  if (!pitch) {
    pitch = document.createElement("pitch");
    const rest = element.getElementsByTagName("rest")[0];
    if (rest) rest.replaceWith(pitch);
    else element.insertBefore(pitch, element.firstChild);
  }

  // `<pitch>` requires its children in this order, so it is simpler to rebuild it than to patch
  // the elements the template left behind.
  pitch.replaceChildren();
  for (const [tagName, text] of [
    ["step", step],
    ["alter", alter.toString()],
    ["octave", octave.toString()],
  ]) {
    const child = document.createElement(tagName);
    child.textContent = text;
    pitch.appendChild(child);
  }

  // Remove the accidental because it might mess up the keySignature feature.
  const accidental = element.getElementsByTagName("accidental")[0];
  if (accidental) accidental.remove();
}

function finalizeComposition(composition: Document) {
  // Make sure all tempo markings are above the staff
  const directionsWithMetronome = composition.querySelectorAll("direction:has(metronome)");
  for (const direction of directionsWithMetronome) {
    if (!direction.getAttribute("placement")) direction.setAttribute("placement", "above");
  }
}
