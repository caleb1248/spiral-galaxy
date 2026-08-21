// Durations in this module are counted in eighth notes, matching `Note.duration` and
// `TemplateData.notesPerMeasure`.

export interface NoteType {
  /** Goes into the `<type>` element. */
  type: string;
  /** How many `<dot>` elements the note needs. */
  dots: number;
}

/** The note head each duration is written with. */
const NOTE_TYPES = new Map<number, NoteType>([
  [1, { type: "eighth", dots: 0 }],
  [2, { type: "quarter", dots: 0 }],
  [3, { type: "quarter", dots: 1 }],
  [4, { type: "half", dots: 0 }],
  [6, { type: "half", dots: 1 }],
  [8, { type: "whole", dots: 0 }],
  [12, { type: "whole", dots: 1 }],
]);

/**
 * The note type for a duration, or null when no single note head can express it. 5, 7, 9, 10
 * and 11 eighths would need a pair of tied notes, which the templates do not use, so features
 * are expected to avoid producing them.
 */
export function noteTypeForDuration(eighths: number): NoteType | null {
  return NOTE_TYPES.get(eighths) ?? null;
}

export function isExpressibleDuration(eighths: number): boolean {
  return NOTE_TYPES.has(eighths);
}
