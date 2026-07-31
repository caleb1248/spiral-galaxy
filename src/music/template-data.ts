export interface TemplateData {
  /** Eighth notes per measure */
  notesPerMeasure: number;
  insertions: Insertion[];
}

export interface Insertion {
  measure: number;
  hand: "right" | "left";
  omit?: number[];
  keySignatureFifths?: number;
}
