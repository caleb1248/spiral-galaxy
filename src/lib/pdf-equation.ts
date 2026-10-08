import type { PDFFont, PDFPage } from "pdf-lib";

/**
 * Just enough math typesetting for the spiral equation — pdf-lib draws strings, not formulas, so
 * fractions have to be laid out by hand.
 *
 * Everything is positioned around an *axis*: the y a fraction bar sits on, and the y a run of text
 * is vertically centred on. A measurement reports `above` and `below` as distances from that axis,
 * which is what lets a fraction nest inside another one — the child is measured the same way and
 * its axis is simply offset from the parent's.
 */
export type MathNode =
  | { kind: "text"; text: string; font: PDFFont; size: number }
  | { kind: "row"; items: MathNode[] }
  | { kind: "frac"; numerator: MathNode; denominator: MathNode; size: number };

export interface MathMetrics {
  width: number;
  /** Distance from the axis up to the top of the node. */
  above: number;
  /** Distance from the axis down to the bottom of the node. */
  below: number;
}

// Roughly where a text face's outlines sit relative to its baseline, as a fraction of the font
// size. Only used to centre glyphs on the axis, so an approximation is enough.
const ASCENT = 0.75;
const DESCENT = 0.22;
/** A glyph's visual middle, measured up from its baseline. This is the point put on the axis. */
const MIDDLE = (ASCENT - DESCENT) / 2;

/** Breathing room on each side of a fraction, and between its bar and the parts it separates. */
const FRACTION_PADDING = 0.3;
const FRACTION_GAP = 0.32;

export function text(content: string, font: PDFFont, size: number): MathNode {
  return { kind: "text", text: content, font, size };
}

export function row(...items: MathNode[]): MathNode {
  return { kind: "row", items };
}

export function frac(numerator: MathNode, denominator: MathNode, size: number): MathNode {
  return { kind: "frac", numerator, denominator, size };
}

export function measure(node: MathNode): MathMetrics {
  switch (node.kind) {
    case "text": {
      // Centring the glyphs on the axis makes `above` and `below` come out equal.
      const half = (ASCENT - MIDDLE) * node.size;
      return { width: node.font.widthOfTextAtSize(node.text, node.size), above: half, below: half };
    }

    case "row": {
      const parts = node.items.map(measure);
      return {
        width: parts.reduce((total, part) => total + part.width, 0),
        above: Math.max(0, ...parts.map((part) => part.above)),
        below: Math.max(0, ...parts.map((part) => part.below)),
      };
    }

    case "frac": {
      const numerator = measure(node.numerator);
      const denominator = measure(node.denominator);
      const gap = FRACTION_GAP * node.size;
      return {
        width: Math.max(numerator.width, denominator.width) + 2 * FRACTION_PADDING * node.size,
        above: gap + numerator.below + numerator.above,
        below: gap + denominator.above + denominator.below,
      };
    }
  }
}

/** Draws `node` with its left edge at `x` and its axis at `axis`. */
export function draw(page: PDFPage, node: MathNode, x: number, axis: number): void {
  switch (node.kind) {
    case "text":
      page.drawText(node.text, {
        x,
        y: axis - MIDDLE * node.size,
        font: node.font,
        size: node.size,
      });
      return;

    case "row": {
      let cursor = x;
      for (const item of node.items) {
        draw(page, item, cursor, axis);
        cursor += measure(item).width;
      }
      return;
    }

    case "frac": {
      const { width } = measure(node);
      const numerator = measure(node.numerator);
      const denominator = measure(node.denominator);
      const gap = FRACTION_GAP * node.size;
      const inset = FRACTION_PADDING * node.size * 0.4;

      page.drawLine({
        start: { x: x + inset, y: axis },
        end: { x: x + width - inset, y: axis },
        thickness: Math.max(0.5, 0.055 * node.size),
      });

      draw(page, node.numerator, x + (width - numerator.width) / 2, axis + gap + numerator.below);
      draw(
        page,
        node.denominator,
        x + (width - denominator.width) / 2,
        axis - gap - denominator.above,
      );
      return;
    }
  }
}
