import type { TemplateData } from "./template-data";
import { constants } from "../constants";
import type { Note } from "../../types";
import { getFeatureHandlers, mergeFeatureConfigs, type Feature } from "./features";
import { noteTypeForDuration, type NoteType } from "./durations";
import { isRest, NOTE_CHILD_ORDER, removeChildren, setChildText, textOf } from "./elements";

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

  const { notesPerMeasure, insertions, defaultFeatures = {} } = templateData;
  const divisionsPerEighth = getDivisionsPerEighth(composition);

  for (const insertion of insertions) {
    // Each insertion works on its own copy, because features rewrite the array in place and
    // several insertions replay the same arm.
    const notes: Note[] = (insertion.hand === "right" ? arm1 : arm2).map(({ midi, duration }) => ({
      midi: midi === null ? null : Math.round(midi),
      duration,
    }));

    const features = getFeatureHandlers(
      mergeFeatureConfigs(defaultFeatures, insertion.features ?? {}),
    );

    features.handleNoteArray(notes, { notesPerMeasure });

    let measureNumber = insertion.measure;

    for (const measureNotes of splitIntoMeasures(notes, notesPerMeasure)) {
      const measure = composition.querySelector(`measure[number="${measureNumber}"]`);
      if (!measure) throw new Error(`Measure ${measureNumber} not found in composition.`);

      console.log("current measure number:", measureNumber);
      populateMeasure(measure, measureNotes, {
        hand: insertion.hand,
        measureNumber,
        divisionsPerEighth,
        features,
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
  const measures: Note[][] = [];
  let current: Note[] = [];
  let filled = 0;

  for (const note of notes) {
    if (!Number.isInteger(note.duration) || note.duration < 1) {
      throw new Error(`A note duration of ${note.duration} eighths is not a whole eighth note.`);
    }

    if (filled + note.duration > notesPerMeasure) {
      throw new Error(
        `A note of ${note.duration} eighths at position ${filled} would cross the barline of a ` +
          `${notesPerMeasure}-eighth measure. Features must not merge notes across a measure.`,
      );
    }

    current.push(note);
    filled += note.duration;

    if (filled === notesPerMeasure) {
      measures.push(current);
      current = [];
      filled = 0;
    }
  }

  if (current.length > 0) measures.push(current);

  return measures;
}

interface MeasureOptions {
  hand: "right" | "left";
  measureNumber: number;
  divisionsPerEighth: number;
  features: Required<Feature>;
}

/** writes a 1-measure section of a snippet*/
function populateMeasure(measure: Element, notes: Note[], options: MeasureOptions) {
  const { hand, measureNumber, divisionsPerEighth, features } = options;
  const slots = getHandSlots(measure, options);
  const beamGroups = readBeamGroups(slots);

  /** Duration in eighths written into each slot we filled, keyed by slot index. */
  const written = new Map<number, number>();
  /** Slots taken over by a longer note, which no longer hold a note of their own. */
  const absorbed = new Set<number>();

  let slotIndex = 0;

  for (const note of notes) {
    if (slotIndex >= slots.length) {
      throw new Error(
        `Measure ${measureNumber} has only ${slots.length} ${hand}-hand note slots, which is ` +
          `not enough for the notes being inserted.`,
      );
    }

    const noteType = noteTypeForDuration(note.duration);
    if (!noteType) {
      throw new Error(
        `A duration of ${note.duration} eighths cannot be written as a single note in measure ` +
          `${measureNumber}.`,
      );
    }

    const element = slots[slotIndex];
    writeNote(element, note, noteType, divisionsPerEighth);
    features.processNoteElement(element, { note, offsetInMeasure: slotIndex, measureNumber });

    written.set(slotIndex, note.duration);
    for (let i = 1; i < note.duration; i++) absorbed.add(slotIndex + i);

    slotIndex += note.duration;
  }

  normalizeBeams(slots, beamGroups, written, absorbed);

  for (const index of absorbed) slots[index].remove();
}

/**
 * The note elements an insertion may overwrite in one measure: the eighth-note slots on the
 * staff belonging to `hand`, in the first voice found on that staff. Chord members are skipped
 * because they share the slot of the note they follow, and the other voices are accompaniment
 * that the template owns.
 */
function getHandSlots(measure: Element, options: MeasureOptions): Element[] {
  const { hand, measureNumber, divisionsPerEighth } = options;
  const staff = hand === "right" ? "1" : "2";

  const onStaff = Array.from(measure.getElementsByTagName("note")).filter(
    (note) => textOf(note, "staff") === staff && note.getElementsByTagName("chord").length === 0,
  );

  const voice = textOf(onStaff[0], "voice");
  const slots = onStaff.filter((note) => textOf(note, "voice") === voice);

  for (const slot of slots) {
    if (
      textOf(slot, "type") !== "eighth" ||
      Number(textOf(slot, "duration")) !== divisionsPerEighth
    ) {
      throw new Error(
        `Measure ${measureNumber} has a ${hand}-hand note that is not a plain eighth note. ` +
          `Measures an insertion writes into have to be written as eighth notes.`,
      );
    }
  }

  return slots;
}

/**
 * Maps each slot to the beam group the template put it in, or null where the template leaves it
 * unbeamed. Groups run from a `begin` beam to the matching `end`.
 */
function readBeamGroups(slots: Element[]): (number | null)[] {
  const groups: (number | null)[] = [];
  let current: number | null = null;
  let nextGroup = 0;

  for (const slot of slots) {
    const beam = textOf(slot, "beam");

    if (beam === "begin") current = nextGroup++;
    groups.push(beam === null ? null : current);
    if (beam === "end") current = null;
  }

  return groups;
}

/**
 * Rebuilds the beams across a measure's slots. Only a surviving eighth note that is not a rest
 * can carry a beam, so merging notes together or silencing them splits the template's groups
 * apart. Each remaining run of two or more beamable slots gets a fresh begin/continue/end, and
 * anything left on its own is unbeamed.
 */
function normalizeBeams(
  slots: Element[],
  beamGroups: (number | null)[],
  written: Map<number, number>,
  absorbed: Set<number>,
) {
  let run: number[] = [];

  const flush = () => {
    if (run.length === 1) removeChildren(slots[run[0]], "beam");

    if (run.length > 1) {
      run.forEach((index, position) => {
        const slot = slots[index];
        removeChildren(slot, "beam");
        setChildText(
          slot,
          "beam",
          position === 0 ? "begin" : position === run.length - 1 ? "end" : "continue",
          NOTE_CHILD_ORDER,
        ).setAttribute("number", "1");
      });
    }

    run = [];
  };

  for (let index = 0; index < slots.length; index++) {
    // Untouched slots are eighth notes, as `getHandSlots` checks, so they default to a
    // duration of one and can still join a run alongside the notes we wrote.
    const beamable =
      !absorbed.has(index) &&
      beamGroups[index] !== null &&
      !isRest(slots[index]) &&
      (written.get(index) ?? 1) === 1;

    if (!beamable) {
      flush();
      if (!absorbed.has(index)) removeChildren(slots[index], "beam");
      continue;
    }

    if (run.length > 0 && beamGroups[index] !== beamGroups[run[run.length - 1]]) flush();
    run.push(index);
  }

  flush();
}

/** Replaces the contents of a template slot with `note`. */
function writeNote(
  element: Element,
  note: Note,
  noteType: NoteType,
  divisionsPerEighth: number,
): void {
  const document = element.ownerDocument;

  if (note.midi === null) writeRest(element);
  else writePitch(element, note.midi);

  setChildText(
    element,
    "duration",
    (note.duration * divisionsPerEighth).toString(),
    NOTE_CHILD_ORDER,
  );
  setChildText(element, "type", noteType.type, NOTE_CHILD_ORDER);

  // A tie would join this note to a template pitch that is no longer there.
  removeChildren(element, "tie");
  removeChildren(element, "tied");

  removeChildren(element, "dot");
  const type = element.getElementsByTagName("type")[0];
  for (let i = 0; i < noteType.dots; i++) type.after(document.createElement("dot"));
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
