import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { draw, frac, measure, row, text, type MathNode } from "./pdf-equation";

/** Whitespace, in PDF points, left around the contents of the page. */
const MARGIN = 48;

/** Space between the bottom of the plot and the top of the equation. */
const CAPTION_GAP = 28;

/** How far the equation sits above the bottom margin, so it is not stranded at the page edge. */
const EQUATION_RISE = 60;

/** Starting size for the equation; it shrinks from here if it would not fit the page width. */
const EQUATION_SIZE = 18;

/** How much of the space available to it the plot actually fills. */
const PLOT_SCALE = 0.7;

/** A4 in points, used only if the score somehow arrives with no pages to measure. */
const FALLBACK_PAGE = { width: 595.28, height: 841.89 };

/** The slider values the equation is written out with — the same ones the controls panel shows. */
export interface EquationParams {
  A: number;
  B: number;
  N: number;
}

/**
 * Appends a final page holding `png` — the plot canvas — with the spiral equation written under
 * it. The page copies the size of the pages already in `pdf` so the plate does not read as a
 * different sheet, and the image is scaled to fit the space the equation leaves without
 * distorting its aspect ratio.
 *
 * @param pdf The document to append to
 * @param png The image, as raw bytes or a `data:image/png;base64,…` URL
 * @param params The slider values to substitute into the equation
 */
export async function appendPlotPage(
  pdf: Uint8Array<ArrayBuffer>,
  png: Uint8Array | ArrayBuffer | string,
  params: EquationParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.load(pdf);
  const image = await document.embedPng(png);

  // Times is the closest a standard PDF font gets to Latin Modern — a serif in the same vein as
  // the one LaTeX sets equations in. It also pairs with Symbol, whose Greek is drawn to match
  // Times, so the theta below sits with the rest of the equation instead of against it.
  const fonts = {
    upright: await document.embedFont(StandardFonts.TimesRoman),
    italic: await document.embedFont(StandardFonts.TimesRomanItalic),
    // Times' WinAnsi encoding has no theta; Symbol is the only standard font that carries it.
    symbol: await document.embedFont(StandardFonts.Symbol),
  };

  const [existing] = document.getPages();
  const { width, height } = existing ? existing.getSize() : FALLBACK_PAGE;
  const available = width - MARGIN * 2;

  // Shrink the equation until it fits across the page rather than letting it run into the margins.
  let equation = spiralEquation(params, fonts, EQUATION_SIZE);
  let equationSize = measure(equation);
  for (let size = EQUATION_SIZE; equationSize.width > available && size > 6; size -= 1) {
    equation = spiralEquation(params, fonts, size);
    equationSize = measure(equation);
  }

  const equationHeight = equationSize.above + equationSize.below;
  const equationBottom = MARGIN + EQUATION_RISE;
  const plotBottom = equationBottom + equationHeight + CAPTION_GAP;
  const plotArea = height - MARGIN - plotBottom;
  const scale = Math.min(available / image.width, plotArea / image.height) * PLOT_SCALE;
  const drawn = { width: image.width * scale, height: image.height * scale };

  const page = document.addPage([width, height]);

  page.drawImage(image, {
    x: (width - drawn.width) / 2,
    y: plotBottom + (plotArea - drawn.height) / 2,
    ...drawn,
  });

  draw(page, equation, (width - equationSize.width) / 2, equationBottom + equationSize.below);

  return (await document.save()) as Uint8Array<ArrayBuffer>;
}

interface EquationFonts {
  upright: PDFFont;
  italic: PDFFont;
  symbol: PDFFont;
}

/**
 * The equation the controls panel renders as MathML, built for pdf-lib instead:
 *
 * ```
 *              A
 *   r = ─────────────────
 *       log(B · tan(θ/2N))
 * ```
 *
 * Keep this in step with the `<math>` block in [ui.tsx](./ui.tsx).
 */
function spiralEquation(params: EquationParams, fonts: EquationFonts, size: number): MathNode {
  const { upright, italic, symbol } = fonts;
  // Parentheses are fixed-height glyphs here, so the ones wrapping a fraction are drawn oversized
  // to stand in for the stretchy brackets MathML gives for free.
  const outer = size * 1.9;
  const inner = size * 1.45;
  const nested = size * 0.85;

  return row(
    text("r ", italic, size),
    text("= ", upright, size),
    frac(
      text(String(params.A), upright, size),
      row(
        text("log", upright, size),
        text("(", upright, outer),
        text(String(params.B), upright, size),
        text(" · ", upright, size),
        text("tan", upright, size),
        text("(", upright, inner),
        frac(
          text("θ", symbol, nested),
          row(text("2 · ", upright, nested), text(String(params.N), upright, nested)),
          nested,
        ),
        text(")", upright, inner),
        text(")", upright, outer),
      ),
      size,
    ),
  );
}
