import { type JSX, useMemo, useState } from "react"
import { Chart, type Datum, type Series } from "./chart"
import type { SimulationRun } from "./local-run"
import { foldEye } from "./model/eye"
import { voltageBounds } from "./model/waveforms"

/** The scope's deterministic two-unit-interval fold and a configurable engineering mask. */
export function ScopeEye({
  run,
  points,
  labels,
}: {
  run: SimulationRun
  points: Datum[][]
  labels: string[]
}): JSX.Element {
  const [index, setIndex] = useState(() =>
    run.capture.probes.findIndex(({ name }) => !run.probes[name]?.isDriver),
  )
  const [skip, setSkip] = useState(1)
  const [phase, setPhase] = useState(0)
  const [showMask, setShowMask] = useState(true)
  const [maskHeight, setMaskHeight] = useState(0.5)
  const [maskWidth, setMaskWidth] = useState(0.35)
  const probeIndex = Math.max(0, index)
  const probe = run.capture.probes[probeIndex]
  const settings = run.probes[probe.name]
  const bitNs = settings ? 1e9 / settings.rateBps : 0
  const signal = points[probeIndex]
  const extent = useMemo(() => voltageBounds(signal), [signal])
  const threshold = run.threshold
    ? (run.threshold.low + run.threshold.high) / 2
    : (settings?.nominalHigh ?? extent.min + extent.max) / 2
  const eye = useMemo(
    () =>
      foldEye({
        points: signal,
        bitNs,
        startNs: (settings?.offsetMs ?? 0) * 1e6,
        skip,
        phase: phase / 100,
        crossingVoltage: threshold,
        maskHeight,
        maskWidth,
      }),
    [signal, bitNs, settings, skip, phase, threshold, maskHeight, maskWidth],
  )
  const failed = eye.violations + eye.betweenSamples > 0
  const series: Series[] = eye.segments.map((segment, position) => ({
    id: `fold-${position}`,
    label: "Folded probe",
    points: segment,
    opacity: 0.36,
    color: 0,
  }))
  const div = Math.max(0.1, (extent.max - extent.min) * 0.1, maskHeight / 4)
  return (
    <div className="wb-editor">
      <div className="wb-tool-row">
        <label>
          Probe{" "}
          <select
            value={probeIndex}
            onChange={(event) => setIndex(Number(event.target.value))}
          >
            {labels.map((label, i) => (
              <option key={run.capture.probes[i].name} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <output>
          {settings
            ? `${settings.rateBps / 1e6} Mbps · ${bitNs.toFixed(2)} ns per bit`
            : "Bit rate unavailable"}
        </output>
        <label>
          Skip bits{" "}
          <input
            type="number"
            min="0"
            max="4"
            step="1"
            value={skip}
            onChange={(event) =>
              setSkip(Math.max(0, Math.min(4, event.target.valueAsNumber || 0)))
            }
          />
        </label>
        <label>
          Phase{" "}
          <input
            type="range"
            min="0"
            max="100"
            value={phase}
            onChange={(event) => setPhase(event.target.valueAsNumber)}
          />
          {phase}%
        </label>
      </div>
      <div className="wb-scope-split">
        <div className="wb-scope-plot">
          {series.length ? (
            <Chart
              scope
              series={series}
              title="Folded eye diagram"
              xUnit="Unit intervals"
              yUnit="V"
              bounds={{
                xMin: 0,
                xMax: 2,
                yMin: Math.min(extent.min, threshold - maskHeight / 2) - div,
                yMax: Math.max(extent.max, threshold + maskHeight / 2) + div,
              }}
              threshold={threshold}
              mask={showMask ? { points: eye.mask, failed } : undefined}
            />
          ) : (
            <p className="wb-placeholder">
              The capture needs two complete unit intervals after the selected
              skip and phase.
            </p>
          )}
        </div>
        <aside className="wb-probe-pane wb-scope-legend">
          <fieldset className="wb-fields">
            <legend>Eye mask</legend>
            <label className="wb-check-label">
              <input
                type="checkbox"
                checked={showMask}
                onChange={(event) => setShowMask(event.target.checked)}
              />{" "}
              Show mask
            </label>
            <label>
              Height (V){" "}
              <input
                type="number"
                min="0.01"
                max="10"
                step="0.05"
                value={maskHeight}
                onChange={(event) =>
                  setMaskHeight(
                    Math.max(0.01, event.target.valueAsNumber || 0.01),
                  )
                }
              />
            </label>
            <label>
              Width (bits){" "}
              <input
                type="number"
                min="0.01"
                max="1"
                step="0.05"
                value={maskWidth}
                onChange={(event) =>
                  setMaskWidth(
                    Math.max(
                      0.01,
                      Math.min(1, event.target.valueAsNumber || 0.01),
                    ),
                  )
                }
              />
            </label>
          </fieldset>
          <dl className="wb-readout">
            <dt>Eye height</dt>
            <dd>
              {eye.height === undefined ? "—" : `${eye.height.toFixed(3)} V`}
            </dd>
            <dt>Eye width</dt>
            <dd>
              {eye.widthFraction === undefined
                ? "—"
                : `${(eye.widthFraction * bitNs).toFixed(2)} ns (${eye.widthFraction.toFixed(2)} UI)`}
            </dd>
            <dt>Crossing</dt>
            <dd>
              {eye.crossingVoltage === undefined
                ? "—"
                : `${eye.crossingVoltage.toFixed(3)} V`}
            </dd>
            <dt>Segments</dt>
            <dd>{series.length}</dd>
          </dl>
          {showMask && series.length > 0 && (
            <strong className="wb-mask-state" data-failed={failed}>
              {failed
                ? `FAIL · ${eye.violations} sample ${eye.violations === 1 ? "hit" : "hits"}`
                : "PASS"}
              {eye.betweenSamples > 0 &&
                ` · ${eye.betweenSamples} between samples`}
            </strong>
          )}
        </aside>
      </div>
    </div>
  )
}
