import type { FeaturesConfig } from "./features";

export interface TemplateData {
  /** Eighth notes per measure */
  notesPerMeasure: number;
  insertions: Insertion[];
  defaultFeatures?: FeaturesConfig;
}

export interface Insertion {
  measure: number;
  hand: "right" | "left";
  features?: FeaturesConfig;
}
