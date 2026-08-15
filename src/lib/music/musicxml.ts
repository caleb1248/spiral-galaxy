import { findNearest } from "../utils";
import type { TemplateData } from "./template-data";
import { constants } from "./constants";

const parser = new DOMParser();

let chromaticAllowed = false;

function getScaleForKeySignature(keySignatureFifths: number): number[] {
  if (keySignatureFifths === 0) return constants.C_MAJOR_SCALE;
  const scale = [...constants.C_MAJOR_SCALE];
  const sharpsOrFlats = keySignatureFifths > 0 ? constants.SHARPS : constants.FLATS;
  const sharpOrFlatIndices =
    keySignatureFifths > 0 ? constants.SHARP_INDICES : constants.FLAT_INDICES;

  for (let i = 0; i < Math.abs(keySignatureFifths); i++) {
    // Replace the note in the scale with the sharp or flat note.
    scale[sharpOrFlatIndices[i]] = sharpsOrFlats[i];
  }

  scale.unshift(scale[scale.length - 1] - 12); // Add the last note of the scale in the previous octave to the beginning of the scale.
  scale.push(scale[0] + 12); // Add the first note of the scale in the next octave to the end of the scale.

  return scale;
}

function adjustNoteToKey(
  note: number,
  keySignatureFifths: number,
): { note: number; octaveChange: number } {
  const scale = getScaleForKeySignature(keySignatureFifths);

  let nearestNote = findNearest(note, scale);
  const octaveChange = nearestNote < 0 ? -1 : nearestNote > 11 ? 1 : 0;
  if (octaveChange !== 0) {
    nearestNote += -octaveChange * 12;
  }
  return { note: nearestNote, octaveChange };
}

function getNoteData(midiNote: number, keySignatureFifths: number) {
  let octave = Math.floor(midiNote / 12);
  let noteInScale = midiNote % 12;

  if (!chromaticAllowed) {
    const { note: nearestNote, octaveChange } = adjustNoteToKey(noteInScale, keySignatureFifths);

    noteInScale = nearestNote;
    octave += octaveChange;
  }

  // There can't be a sharp or flat inside the pitch tag, so we will assign a sharp or flat.
  // If the note is in the key signature, we will use that. Otherwise, we will use the nearest note in the C major scale.
  const accidentalIndex = (keySignatureFifths > 0 ? constants.SHARPS : constants.FLATS).indexOf(
    noteInScale,
  );

  // If the note is in the key signature, ensure that the `alter` is set to the correct value.
  // If it is a flat, the `alter` should be -1. If it is a sharp, the `alter` should be 1. If it is a natural, the `alter` should be 0.
  if (accidentalIndex !== -1 && accidentalIndex < Math.abs(keySignatureFifths)) {
    const alter = Math.sign(keySignatureFifths);
    console.log("is in key signature, the note is", constants.CHROMATIC_SCALE[noteInScale]);
    let realPitch = noteInScale - alter;

    // Adjust octave if the realPitch goes out of bounds (0-11)
    if (realPitch < 0) {
      octave--;
      realPitch += 12;
    }

    if (realPitch > 11) {
      octave++;
      realPitch -= 12;
    }

    return { pitch: constants.CHROMATIC_SCALE[realPitch].toUpperCase(), alter, octave };
  }

  // The note is not in the key signature.
  const nearestNote = findNearest(noteInScale, constants.C_MAJOR_SCALE);
  const pitch = constants.CHROMATIC_SCALE[nearestNote].toUpperCase();
  const alter = nearestNote - noteInScale;
  return { pitch, alter, octave };
}

/**
 * Inserts the galaxy snippets into the provided template composition
 * @param xml The template composition in MusicXML format
 * @param templateData Contains information on where to insert the galaxy snippets into the template composition
 * @param arm1 The galaxy snippet for the right hand
 * @param arm2 The galaxy snippet for the left hand
 * @param allowChromatic If false, snippet notes will be adjusted to the current scale.
 * @returns The completed composition in MusicXML format
 */
export function populateComposition(
  xml: string,
  templateData: TemplateData,
  arm1: number[],
  arm2: number[],
  allowChromatic = false,
): string {
  arm1 = arm1.map((note) => Math.round(note));
  arm2 = arm2.map((note) => Math.round(note));
  chromaticAllowed = allowChromatic;

  const parsedComposition = parser.parseFromString(xml, "application/xml");
  const { notesPerMeasure, insertions } = templateData;

  for (const insertion of insertions) {
    let currentMeasure = insertion.measure;

    const notes = insertion.hand === "right" ? arm1 : arm2;

    for (let i = 0; i < notes.length; i += notesPerMeasure) {
      const measure = parsedComposition.querySelector(`measure[number="${currentMeasure}"]`);
      if (!measure) throw new Error(`Measure ${currentMeasure} not found in composition.`);

      const measureSlice = notes.slice(i, i + notesPerMeasure);
      const { keySignatureFifths = 0 } = insertion;

      if (insertion.hand === "right") {
        populateRightHand(measure, measureSlice, insertion.omit || [], keySignatureFifths);
      }

      if (insertion.hand === "left") {
        populateLeftHand(measure, measureSlice, insertion.omit || [], keySignatureFifths);
      }

      currentMeasure++;
    }
  }

  finalizeComposition(parsedComposition);

  return new XMLSerializer().serializeToString(parsedComposition);
}

/**
 * Inserts the provided snippet into the right hand for one measure.
 * Since the right hand is always the first hand, we can just iterate through the first notes and insert them into the measure.
 */
function populateRightHand(
  measure: Element,
  notes: number[],
  omit: number[],
  keySignatureFifths: number,
) {
  const measureNotes = measure.getElementsByTagName("note");
  const ownerDocument = measure.ownerDocument;
  let beamsToUpdate: BeamsToUpdate[] = [];

  for (let i = 0; i < notes.length; i++) {
    const noteElement = measureNotes[i];

    applyBeamUpdates(noteElement, beamsToUpdate);
    beamsToUpdate = updateNote(
      ownerDocument,
      noteElement,
      omit.includes(i) ? null : notes[i],
      keySignatureFifths,
    );
  }
}

/**
 * Inserts the provided snippet into the left hand for one measure.
 */
function populateLeftHand(
  measure: Element,
  notes: number[],
  omit: number[],
  keySignatureFifths: number,
) {
  const measureNotes = measure.getElementsByTagName("note");
  const ownerDocument = measure.ownerDocument;

  // We don't know how many notes are in the right hand, so we find the first note that contains <staff>2</staff>
  let leftHandStartIndex = 0;
  for (let i = 0; i < measureNotes.length; i++) {
    const noteElement = measureNotes[i];
    const staffElement = noteElement.getElementsByTagName("staff")[0];
    if (staffElement && staffElement.textContent === "2") {
      leftHandStartIndex = i;
      break;
    }
  }

  // Now that we know where the left hand starts, we can add the notes for the left hand.
  let beamsToUpdate: BeamsToUpdate[] = [];
  for (let i = leftHandStartIndex; i < measureNotes.length; i++) {
    const realI = i - leftHandStartIndex;
    const noteElement = measureNotes[i];
    applyBeamUpdates(noteElement, beamsToUpdate);
    beamsToUpdate = updateNote(
      ownerDocument,
      noteElement,
      omit.includes(realI) ? null : notes[realI],
      keySignatureFifths,
    );
  }
}

/**
 * Swaps out the content of an element inside the <pitch> tag with the new content. If the element does not exist, it will be created.
 */
function adjustPitchData(doc: Document, pitchElement: Element, tagName: string, content: string) {
  let element = pitchElement.getElementsByTagName(tagName)[0];
  if (!element) {
    element = doc.createElement(tagName);
    pitchElement.appendChild(element);
  }

  element.textContent = content;
}

/**
 * Used by {@link updateNote} to update the beam elements in the next note.
 *
 * For example, `<beam number="1">begin<beam>` would translate to `{ number: 1, setTo: "begin" }`
 */
interface BeamsToUpdate {
  /** Which beam to set. Refers to the number attribute in `<beam>` element */
  number: number;

  /**
   * Refers to the content of the `<beam>` element.
   * Note: If the beam is going to be set to "end" but it is currently "begin", the beam should be removed.
   */
  setTo: "begin" | "continue" | "end";
}

/** Applies beam changes carried over from the preceding note. */
function applyBeamUpdates(noteElement: Element, updates: BeamsToUpdate[]) {
  for (const update of updates) {
    const beam = Array.from(noteElement.getElementsByTagName("beam")).find(
      (candidate) => candidate.getAttribute("number") === update.number.toString(),
    );

    // A beam that is already beginning cannot end on the same note. In that
    // case, remove it rather than producing an invalid begin/end beam.
    if (update.setTo === "end" && beam?.textContent === "begin") {
      beam.remove();
      continue;
    }

    if (beam) {
      beam.textContent = update.setTo;
      continue;
    }

    const newBeam = noteElement.ownerDocument.createElement("beam");
    newBeam.setAttribute("number", update.number.toString());
    newBeam.textContent = update.setTo;
    noteElement.appendChild(newBeam);
  }
}

/**
 * Changes the pitch of an existing note to the target pitch.
 */
function updateNote(
  doc: Document,
  noteElement: Element,
  midiNote: number | null,
  keySignatureFifths: number,
): BeamsToUpdate[] {
  const pitchElement = noteElement.getElementsByTagName("pitch")[0];

  if (midiNote === null) {
    // If `midiNote` is null, then it is a rest.
    if (pitchElement) {
      pitchElement.replaceWith(pitchElement.ownerDocument.createElement("rest"));
    }

    const beamsToUpdate: BeamsToUpdate[] = [];
    for (const beam of Array.from(noteElement.getElementsByTagName("beam"))) {
      if (beam.textContent === "begin") {
        const number = Number(beam.getAttribute("number"));
        if (!Number.isNaN(number)) {
          beamsToUpdate.push({ number, setTo: "begin" });
        }
        beam.remove();
      }
    }

    return beamsToUpdate;
  }

  const { pitch: step, alter, octave } = getNoteData(midiNote, keySignatureFifths);

  adjustPitchData(doc, pitchElement, "step", step);
  adjustPitchData(doc, pitchElement, "alter", alter.toString());
  adjustPitchData(doc, pitchElement, "octave", octave.toString());

  return [];
}

function finalizeComposition(doc: Document) {
  // Make sure all tempo markings are above the staff
  const directionsWithMetronome = doc.querySelectorAll("direction:has(metronome)");
  for (const direction of directionsWithMetronome) {
    if (!direction.getAttribute("placement")) direction.setAttribute("placement", "above");
  }
}
