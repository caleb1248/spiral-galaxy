import { findNearest } from "../utils";
import type { TemplateData } from "./template-data";
import { constants } from "./constants";

const parser = new DOMParser();

function getNoteData(midiNote: number, keySignatureFifths: number) {
  let octave = Math.floor(midiNote / 12);
  const noteInScale = midiNote % 12;

  // There can't be a sharp or flat inside the pitch tag, so we will assign a sharp or flat.
  // If the note is in the key signature, we will use that. Otherwise, we will use the nearest note in the C major scale.
  const accidentalIndex = (keySignatureFifths > 0 ? constants.SHARPS : constants.FLATS).indexOf(
    noteInScale,
  );

  // If the note is in the key signature, ensure that the `alter` is set to the correct value.
  // If it is a flat, the `alter` should be -1. If it is a sharp, the `alter` should be 1. If it is a natural, the `alter` should be 0.
  if (accidentalIndex !== -1 && accidentalIndex < Math.abs(keySignatureFifths)) {
    const alter = Math.sign(keySignatureFifths);
    let realPitch = noteInScale - alter + 12;

    // Adjust octave if the realPitch goes out of bounds (0-11)
    if (realPitch < 0) {
      octave--;
      realPitch += 12;
    }

    if (realPitch > 11) {
      octave++;
      realPitch -= 12;
    }

    return { pitch: constants.CHROMATIC_SCALE[realPitch], alter, octave };
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
 * @returns The completed composition in MusicXML format
 */
export function populateComposition(
  xml: string,
  templateData: TemplateData,
  arm1: number[],
  arm2: number[],
): string {
  const parsedComposition = parser.parseFromString(xml, "application/xml");
  const { notesPerMeasure, insertions } = templateData;

  for (const insertion of insertions) {
    let currentMeasure = insertion.measure;

    const notes = insertion.hand === "right" ? arm1 : arm2;

    for (let i = 0; i < notes.length; i += notesPerMeasure) {
      const measure = parsedComposition.querySelector(`measure[number="${currentMeasure}"]`);
      console.log("measure", measure, currentMeasure);
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
  console.log(Object.getPrototypeOf(measure).constructor.name);
  const measureNotes = measure.getElementsByTagName("note");
  const ownerDocument = measure.ownerDocument;

  for (let i = 0; i < notes.length; i++) {
    const noteElement = measureNotes[i];

    updateNote(ownerDocument, noteElement, omit.includes(i) ? null : notes[i], keySignatureFifths);
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
  for (let i = leftHandStartIndex; i < measureNotes.length; i++) {
    const realI = i - leftHandStartIndex;
    const noteElement = measureNotes[i];
    updateNote(
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
 * Changes the pitch of an existing note to the target pitch.
 */
function updateNote(
  doc: Document,
  noteElement: Element,
  midiNote: number | null,
  keySignatureFifths: number,
) {
  const pitchElement = noteElement.getElementsByTagName("pitch")[0];

  if (!midiNote) {
    if (pitchElement) {
      pitchElement.replaceWith(pitchElement.ownerDocument.createElement("rest"));
    }

    return;
  }

  const { pitch: step, alter, octave } = getNoteData(midiNote, keySignatureFifths);

  adjustPitchData(doc, pitchElement, "step", step);
  adjustPitchData(doc, pitchElement, "alter", alter.toString());
  adjustPitchData(doc, pitchElement, "octave", octave.toString());
}
