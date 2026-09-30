# Spiral Galaxy Composition

A browser app that generates a spiral galaxy from a set of parameters, maps each star's distance
from the center to a MIDI pitch, plays the result back, and renders it into a full piano score
(PDF) or a MIDI file.

The pipeline is: **parameters → star positions → pitches → playback / MusicXML → PDF**.

## Commands

Package manager is **bun** (`bun.lock`); the dev server and bundler are **Vite**.

| Task                                     | Command                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| Dev server (Vite, http://localhost:5173) | `bun run dev`                                           |
| Production build                         | `bun run build`                                         |
| Type check                               | `bunx tsc` (`noEmit` is already set in `tsconfig.json`) |
| Install deps                             | `bun install`                                           |

There is no test suite and no linter. Formatting is **oxfmt** (`.oxfmtrc.json`, VS Code formatter
is `oxc.oxc-vscode`); `public/templates/*.json` is excluded from formatting because its hand-aligned
rhythm arrays are meaningful.

TypeScript notes: `verbatimModuleSyntax` (use `import type` for types), `allowImportingTsExtensions`,
`erasableSyntaxOnly` (no enums, no parameter properties), `noUnusedLocals` / `noUnusedParameters`.
Top-level `await` is used freely — this is an ES-module browser bundle, not Node.

## Reference docs

- [math.md](math.md) — **the source of truth for the spiral math.** Contains the LaTeX exported from
  the original Desmos graph for every parameter and equation. When touching star-position code,
  keep the LaTeX comment above each expression in sync with this file.
- [src/lib/music/xml/features.md](src/lib/music/xml/features.md) — how "features" (the transforms
  applied to a snippet before/while it becomes MusicXML) are meant to work.
- [prompts.txt](prompts.txt) — the prompt history used to derive and validate the spiral equations,
  including the arXiv paper the model is based on. Useful background, not a spec.

## Layout

### Entry points

- [index.html](index.html) — static shell: header, controls panel (emptied and replaced by React at
  startup), and the `#plot` canvas. Some markup here is dead/hidden and duplicated in
  [src/lib/ui.tsx](src/lib/ui.tsx).
- [src/main.ts](src/main.ts) — the app. Computes the spiral, owns the Pixi renderer, the playback
  loop, and the star-to-pitch mapping. Largest file in the project; everything else is a library it
  pulls from.
- [src/style.css](src/style.css) — all styling, dark theme via CSS custom properties on `:root`.

### `src/lib/` — shared code

- [state.ts](src/lib/state.ts) — the slider definitions (`extraSliderDefs`: key, range, step,
  default, optional `format`) and the mutable `state` object every module reads. `SHOWN_SLIDERS`
  gates which sliders the UI exposes; `SHOULD_HIDE_UNEXPOSED_SLIDERS` currently limits it to
  `A, B, N, C, d`.
- [math.md-backed math.ts](src/lib/math.ts) — `mulberry32` (seeded RNG), `normalDist`, `scaledC`,
  `attenuation`, `spiralDenominator`, `markerArea`, `notePerSecond`. Each function carries the
  LaTeX it implements in its doc comment.
- [types.ts](src/lib/types.ts) — `Point`, `Note`, `State`, `Bounds`, `SpiralData`, `UiWatch`.
- [ui.tsx](src/lib/ui.tsx) — the React controls panel (sliders, highlight mode, parameter watch,
  play / export buttons). Mounted imperatively by `main.ts` via `mountControls`; state flows back
  out through the `uiStateRef` / `updateWatch` escape hatches rather than through React.
- [utils.ts](src/lib/utils.ts) — `scale` (overloaded range remap), `downloadFile`, `midiNote`,
  `findNearest`, `fetchText`, `waitForImageToLoad`.
- [webmscore.ts](src/lib/webmscore.ts) — thin wrapper: MusicXML string → PDF bytes.
- [debug-format-xml.ts](src/lib/debug-format-xml.ts) — pretty-prints MusicXML for eyeballing
  generator output. Debug only.
- [assets/starfield.png](src/assets/starfield.png) — canvas background.

### `src/lib/music/` — sound and score generation

- [index.ts](src/lib/music/index.ts) — the music entry point: the Tone.js piano sampler,
  `setNotes` / `playNote` (live playback), `convertNote` (MIDI number → name), `exportPdf`, and the
  `globalThis.exportMidi` hook that `index.html`'s button calls. Also owns `indicies`, the two
  playback index tracks (arm 1, arm 2, `null` = silent) that `main.ts` fills in.
- [constants.ts](src/lib/music/constants.ts) — chromatic scale names, C-major degrees, sharp/flat
  orderings used for key signatures.
- **`midi/`** — MIDI export.
  - [merge-tracks.ts](src/lib/music/midi/merge-tracks.ts) — builds a `@tonejs/midi` file from the
    two arms.
  - [patch-key-signature.ts](src/lib/music/midi/patch-key-signature.ts) — re-parses the written file
    with `midi-file` to inject a key signature that webmscore would otherwise ignore.
- **`xml/`** — MusicXML / score generation, the most involved part of the codebase.
  - [main.ts](src/lib/music/xml/main.ts) — `populateComposition`: parses the template MusicXML,
    walks each insertion in the template data, runs its features over the notes, splits them into
    measures, and writes them into the template's `<measure>` elements.
  - [features.ts](src/lib/music/xml/features.ts) — the feature implementations and registry
    (`copyFromArm`, `range`, `reverse`, `invert`, `loop`, `omit`, `keySignature`, `duplicateNotes`,
    `doubleNote`, `subset`), the `FeaturesConfig` type, `mergeFeatureConfigs`, and `featureOrder`
    — features run in a fixed order, not config order.
  - [template-data.ts](src/lib/music/xml/template-data.ts) — the shape of the `template-*.json`
    files (`insertions`, `defaultFeatures`, `notesPerMeasure`, `octaveShifts`).
  - [elements.ts](src/lib/music/xml/elements.ts) — DOM helpers that respect MusicXML's required
    `<note>` child ordering (`NOTE_CHILD_ORDER`, `insertOrdered`, `setChildText`, `textOf`).
  - [8va.ts](src/lib/music/xml/8va.ts) — adds `8va`/`8vb` directions over runs of out-of-staff notes
    for readability, after the insertions are written.

### `public/` — fetched at runtime

- [public/templates/](public/templates/) — the composition templates. Each is a pair:
  `template-N.musicxml` (the hand-written piece with empty measures) and `template-N.json` (where to
  insert galaxy snippets and which features to apply). **`template-2` is the one currently loaded**
  — see the `TEMPLATE_XML` / `TEMPLATE_DATA` constants at the bottom of
  [src/lib/music/index.ts](src/lib/music/index.ts).
- [public/sounds/piano/](public/sounds/piano/) — the four sample points (C4, D#4, F#4, A4) the Tone
  sampler interpolates from.
- [public/font/](public/font/) — Inter Variable woff2 files.

## Dependencies

| Package                                                | Used for                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pixi.js`                                              | All canvas rendering — stars, spiral scaffold, highlight, and the 2000-sprite dust/halo particle layer. Rendering is manual (`autoStart: false`) and driven by `requestRender()`. |
| `react` / `react-dom`                                  | The controls panel only ([ui.tsx](src/lib/ui.tsx)). The rest of the app is imperative.                                                                                            |
| `tone`                                                 | Live playback: `Tone.Sampler` over the piano samples. Needs a user gesture before `Tone.start()`.                                                                                 |
| `@tonejs/midi`                                         | Writing the MIDI export (tracks, tempo, time signature).                                                                                                                          |
| `midi-file`                                            | Low-level re-write of the exported MIDI to patch in the key signature. Intended to eventually replace `@tonejs/midi` entirely.                                                    |
| `webmscore`                                            | MuseScore compiled to WASM — renders the generated MusicXML to PDF in the browser.                                                                                                |
| `vite` (dev)                                           | Dev server and bundler.                                                                                                                                                           |
| `typescript` (dev)                                     | Type checking only; Vite strips types.                                                                                                                                            |
| `@types/bun`, `@types/react`, `@types/react-dom` (dev) | Types.                                                                                                                                                                            |

## Conventions and gotchas

- **Keep the LaTeX comments.** Every spiral expression in `main.ts` and `math.ts` is annotated with
  the equation from [math.md](math.md) it implements. New math goes in with its equation.
- `C` is never used raw — always through `scaledC(C, B, N)`.
- `math.md` fixes `p` at 40. The `p` slider still exists for debugging but is hidden.
- Arm 2 is played and exported reversed (high → low, middle → edge). This reversal is applied at
  playback (`_playNote`) and at export time, not in the geometry.
- `state` is a plain mutable object; sliders write to it directly and then call
  `onScheduleRecompute()`. There is no reactive store.
- `indicies` drives both playback and the highlight — it is longer than `points` (arm 1 alone, then
  arm 2 alone, then both together) and contains `null` for silent slots.
- MusicXML is order-sensitive; use the helpers in [elements.ts](src/lib/music/xml/elements.ts)
  rather than `appendChild` when adding children to `<note>`.
- There is a fair amount of commented-out code (old canvas 2D drawing, alternate note ranges, the
  hidden highlight-mode/watch markup in `index.html`). It is kept deliberately — leave it unless
  asked to clean up.

## Nitty-gritty tool use guidelines

- The bash tool should be used to run actual programs (such as dev servers, package managment, type checking, building). It should _not_ be used to modify files.
  - **Important exception:** Files with 1000+ lines of code can be read and edited using bash commands, including: MusicXML files (for reference they are about 18K lines average, very big), and bundled files in node_modules.
