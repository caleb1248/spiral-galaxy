import type { FeaturesConfig } from "./features";
import type { OctaveShiftOptions } from "./8va";

export interface TemplateData {
  /** Eighth notes per measure, where an insertion does not bring its own `notesPerMeasure`. */
  notesPerMeasure?: number;
  insertions: Insertion[];
  defaultFeatures?: FeaturesConfig;
  /** Tuning for the octave shifts that are added automatically after the insertions. */
  octaveShifts?: OctaveShiftOptions;
  /**
   * Replaces the template's own `<work-title>` and the credit that engraves it. The template JSON
   * does not carry this — `exportPdf` fills it in from the title box before each export.
   */
  title: string;
}

export interface Insertion {
  measure: number;
  hand: "right" | "left";
  features?: FeaturesConfig;
}
