import type { TemplateData } from "./template-data";
import { constants } from "../constants";
import type { Note } from "../../types";
import { getFeatureHandlers, mergeFeatureConfigs } from "./features";

const parser = new DOMParser();

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
  arm1: Note[],
  arm2: Note[],
): string {
  const features = templateData.defaultFeatures || {};

  arm1 = arm1.map(({ midi, duration }) => ({ duration, midi: midi ? Math.round(midi) : null }));
  arm2 = arm2.map(({ midi, duration }) => ({ duration, midi: midi ? Math.round(midi) : null }));

  const parsedComposition = parser.parseFromString(xml, "application/xml");
  const { notesPerMeasure, insertions } = templateData;

  for (const insertion of insertions) {
    // split the notes into measures and insert them into the composition
    let currentMeasure = insertion.measure;

    const notes = insertion.hand === "right" ? arm1 : arm2;
    const mergedFeatures = mergeFeatureConfigs(features, insertion.features || {});
    const featureHandlers = getFeatureHandlers(mergedFeatures);

    featureHandlers.handleNoteArray?.(notes);

    for (let i = 0; i < notes.length; i += notesPerMeasure) {
      const measure = parsedComposition.querySelector(`measure[number="${currentMeasure}"]`);
      if (!measure) throw new Error(`Measure ${currentMeasure} not found in composition.`);

      const measureSlice = notes.slice(i, i + notesPerMeasure);

      if (insertion.hand === "right") {
        populateRightHand(measure, measureSlice);
      }

      if (insertion.hand === "left") {
        populateLeftHand(measure, measureSlice);
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
function populateRightHand(measure: Element, notes: Note[]) {
  const measureNotes = measure.getElementsByTagName("note");
  const ownerDocument = measure.ownerDocument;
  let beamsToUpdate: BeamsToUpdate[] = [];

  for (let i = 0; i < notes.length; i++) {
    const noteElement = measureNotes[i];

    applyBeamUpdates(noteElement, beamsToUpdate);
    beamsToUpdate = updateNote(ownerDocument, noteElement, notes[i].midi);
  }
}

/**
 * Inserts the provided snippet into the left hand for one measure.
 */
function populateLeftHand(measure: Element, notes: Note[]) {
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
    beamsToUpdate = updateNote(ownerDocument, noteElement, notes[realI].midi);
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
function updateNote(doc: Document, noteElement: Element, midiNote: number | null): BeamsToUpdate[] {
  const pitchElement = noteElement.getElementsByTagName("pitch")[0];

  if (midiNote === null) {
    // If `midiNote` is null, then it is a rest.
    if (pitchElement) {
      pitchElement.replaceWith(pitchElement.ownerDocument.createElement("rest"));
    }

    // generate beam updates
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

  let alter = 0;
  if (!constants.C_MAJOR_SCALE[midiNote % 12]) {
    alter++;
    midiNote--;
  }

  const step = constants.CHROMATIC_SCALE[midiNote % 12].toUpperCase();
  const octave = Math.floor(midiNote / 12);

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
