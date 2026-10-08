import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { extraSliderDefs, SHOWN_SLIDERS, state } from "./state";
import { exportPdf } from "./music";
import type { UiWatch } from "./types";
import { scaledC } from "./math";

export type HighlightMode = "all" | "positive" | "negative";

type UiProps = {
  onPlay: () => void;
  onHighlightModeChange: (mode: HighlightMode) => void;
  onScheduleRecompute: () => void;
};

export const uiStateRef: { current: { highlightMode: HighlightMode } } = {
  current: { highlightMode: "all" },
};

let setWatchState: (watch: UiWatch) => void = () => {};

export function updateWatch(watch: UiWatch): void {
  setWatchState(watch);
}

function SpiralControlsPanel({ onPlay, onHighlightModeChange, onScheduleRecompute }: UiProps) {
  const [sliders, setSliders] = useState(() => ({ ...state }));
  const [highlightMode, setHighlightModeState] = useState<HighlightMode>(
    uiStateRef.current.highlightMode,
  );
  const [watchState, setWatchStateLocal] = useState<UiWatch>({
    index: "—",
    R: "—",
    step: "—",
    eta: "—",
  });

  useEffect(() => {
    setWatchState = setWatchStateLocal;
    return () => {
      setWatchState = () => {};
    };
  }, []);

  const sliderControls = extraSliderDefs.map((def) => {
    const key = def.key as keyof typeof sliders;
    if (!SHOWN_SLIDERS.includes(key)) return null;
    const v = sliders[key];
    return (
      <div className="control">
        <div className="control-label">
          <label htmlFor={`slider-${def.key}`} style={{ maxWidth: "200px" }}>
            {def.label}
          </label>
          <span className="value">{def.format ? def.format(state[key]) : state[key]}</span>
        </div>

        <input
          type="range"
          id={`slider-${def.key}`}
          min={String(def.min)}
          max={String(def.max)}
          step={String(def.step)}
          value={String(v)}
          onInput={(e) => {
            const next = +e.currentTarget.value;
            setSliders((prev) => {
              const maxC = scaledC(1, +prev.B, prev.N);
              for (let i = 0; i < extraSliderDefs.length; i++) {
                if (extraSliderDefs[i].key === "C") {
                  extraSliderDefs[i].max = maxC;
                }
              }

              const newC = Math.min(def.key == "C" ? next : prev.C, scaledC(1, +prev.B, prev.N));

              return {
                ...prev,
                [def.key]: next,
                C: newC,
              };
            });
            state[key] = next;
            onScheduleRecompute();
          }}
        />
      </div>
    );
  });

  const changeHighlightMode = (mode: HighlightMode) => {
    setHighlightModeState(mode);
    onHighlightModeChange(mode);
  };

  return (
    <>
      <h2 className="group-title">Variables</h2>
      <div>{sliderControls}</div>

      <div className="button-row">
        <button type="button" onClick={onPlay}>
          Listen to your galaxy
        </button>
        <button type="button" onClick={() => exportPdf()}>
          Generate composition
        </button>
      </div>

      <hr
        style={{
          border: "none",
          borderTop: "1px solid rgba(48, 54, 61, 0.72)",
        }}
      />
      <div
        style={{ padding: "1rem", display: "flex", justifyContent: "center", fontSize: "1.5rem" }}
        dangerouslySetInnerHTML={{
          __html: `
<math>
  <mrow>
    <mi>r</mi>
    <mo>=</mo>
    <mfrac>
      <mi>${sliders.A}</mi>
      <mrow>
        <mrow>
          <mi>log</mi>
          <mo>⁡</mo>
        </mrow>
        <mrow>
          <mo fence="true" form="prefix" stretchy="true">(</mo>
          <mi>${sliders.B}</mi>
          <mo>⋅</mo>
          <mrow>
            <mi>tan</mi>
            <mo>⁡</mo>
          </mrow>
          <mrow>
            <mo fence="true" form="prefix" stretchy="true">(</mo>
            <mfrac>
              <mi scriptlevel="2" style="math-depth:2;">θ</mi>
              <mrow scriptlevel="2" style="math-depth:2;">
                <mn>2</mn>
                <mi>${sliders.N}</mi>
              </mrow>
            </mfrac>
            <mo fence="true" form="postfix" stretchy="true">)</mo>
          </mrow>
          <mo fence="true" form="postfix" stretchy="true">)</mo>
        </mrow>
      </mrow>
    </mfrac>
  </mrow>
</math>
`,
        }}
      ></div>

      <fieldset className="radio-card">
        <legend>Highlight mode</legend>
        <label>
          <input
            type="radio"
            name="highlightMode"
            value="all"
            checked={highlightMode === "all"}
            onChange={() => changeHighlightMode("all")}
          />
          Sequential: every i
        </label>
        <label>
          <input
            type="radio"
            name="highlightMode"
            value="positive"
            checked={highlightMode === "positive"}
            onChange={() => changeHighlightMode("positive")}
          />
          Only positive ηᵢ = Ggᵢ·a<sub>dj,i</sub>
        </label>
        <label>
          <input
            type="radio"
            name="highlightMode"
            value="negative"
            checked={highlightMode === "negative"}
            onChange={() => changeHighlightMode("negative")}
          />
          Only negative ηᵢ = Ggᵢ·a<sub>dj,i</sub>
        </label>
      </fieldset>

      <section className="watch" aria-label="Parameter watch">
        <h2>Parameter watch</h2>
        <div className="metric">
          <span className="name">Current index i</span>
          <span className="number">{watchState.index}</span>
        </div>
        <div className="metric">
          <span className="name">Distance from center Rᵢ</span>
          <span className="number">{watchState.R}</span>
        </div>
        <div className="metric">
          <span className="name">||Pᵢ − Pᵢ₊₁||</span>
          <span className="number">{watchState.step}</span>
        </div>
        <div className="metric">
          <span className="name">
            ηᵢ = Ggᵢ·a<sub>dj,i</sub>
          </span>
          <span className="number">{watchState.eta}</span>
        </div>
      </section>
    </>
  );
}

export function mountControls(container: HTMLElement, props: UiProps) {
  container.replaceChildren();
  const root = createRoot(container);
  root.render(<SpiralControlsPanel {...props} />);
  return root;
}
