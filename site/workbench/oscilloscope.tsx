import { type JSX, useMemo, useState } from "react"
import { Chart, type Datum, type Series, sampleAt, seriesColor } from "./chart"
import type { SimulationRun } from "./local-run"
import { fixed } from "./model/labels"
import { measureWaveform, probePoints, voltageBounds } from "./model/waveforms"
import { ScopeEye } from "./scope-eye"
import "./scope.css"

const tabs = ["Waveforms", "Eye Diagram", "Measurements"] as const
export type ScopeTab = (typeof tabs)[number]
const cursorIds = ["A", "B"] as const
type CursorId = (typeof cursorIds)[number]

/** Format a measurement without fabricating absent values. */
function metric(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "—"
  return fixed({ value, digits: 3 })
}

/** Express each measured voltage probe as a named driver or receiver. */
function probeLabels(run: SimulationRun): string[] {
  return run.capture.probes.map(({ name }) => {
    const channel = run.probes[name]
    if (!channel) return name
    return `${channel.name} ${channel.isDriver ? "driver" : "receiver"}`
  })
}

/** Calculate the measurement table for the current capture and previous compatible probes. */
function scopeMeasurements({
  run,
  points,
}: {
  run: SimulationRun
  points: Datum[][]
}): ReturnType<typeof measureWaveform>[] {
  return run.capture.probes.map(({ name }, index) => {
    const meta = run.probes[name]
    const driver = run.capture.probes.findIndex(
      ({ name }) =>
        run.probes[name]?.isDriver && run.probes[name]?.driver === meta?.driver,
    )
    return measureWaveform({
      points: points[index],
      nominalHigh: meta?.nominalHigh,
      driver: index !== driver ? points[driver] : undefined,
      bitNs: meta ? 1e9 / meta.rateBps : undefined,
    })
  })
}

interface ScopeOptions {
  runs: SimulationRun[]
  run?: SimulationRun
  selectRun: (id: number) => void
  tab: ScopeTab
  selectTab: (tab: ScopeTab) => void
  compare: boolean
  toggleCompare: () => void
  exportCsv?: () => void
  exportPng?: () => void
}

/** Capture chooser and tabbed oscilloscope instrument. */
export function Oscilloscope({
  runs,
  run,
  selectRun,
  tab,
  selectTab,
  compare,
  toggleCompare,
  exportCsv,
  exportPng,
}: ScopeOptions): JSX.Element {
  const previous =
    run &&
    runs.findLast(
      (item) => item.id < run.id && item.simulationId === run.simulationId,
    )
  return (
    <div className="wb-editor wb-scope">
      <div className="wb-tabs" role="tablist" aria-label="Oscilloscope mode">
        {tabs.map((value) => (
          <button
            role="tab"
            key={value}
            aria-selected={value === tab}
            onClick={() => selectTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {!run && (
        <p className="wb-placeholder">
          Run a transient simulation to capture driver and receiver voltages.
        </p>
      )}
      {run && (
        <>
          <div className="wb-tool-row">
            <label>
              Run{" "}
              <select
                value={run.id}
                onChange={(event) => selectRun(Number(event.target.value))}
              >
                {runs.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} · {item.name} ·{" "}
                    {new Date(item.timestamp).toLocaleTimeString("en-GB")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={compare && previous !== undefined}
                disabled={!previous}
                onChange={toggleCompare}
              />{" "}
              Compare Previous
            </label>
            <button disabled={!exportCsv} onClick={exportCsv}>
              Export CSV
            </button>
            <button disabled={!exportPng} onClick={exportPng}>
              Export PNG
            </button>
            <span className="wb-capture-state">
              {run.capture.timestampsSeconds.length.toLocaleString()} ngspice
              samples
            </span>
          </div>
          <div className="wb-scope-content" role="tabpanel">
            <CaptureView
              key={run.id}
              run={run}
              previous={compare ? previous : undefined}
              tab={tab}
            />
          </div>
        </>
      )}
    </div>
  )
}

/** Preserve instrument state while switching tabs within a single result. */
function CaptureView({
  run,
  previous,
  tab,
}: {
  run: SimulationRun
  previous?: SimulationRun
  tab: ScopeTab
}): JSX.Element {
  const [hidden, setHidden] = useState<string[]>([])
  const [cursorPos, setCursorPos] = useState<Partial<Record<CursorId, number>>>(
    {},
  )
  const [hiddenCursors, setHiddenCursors] = useState<CursorId[]>([])
  const [reset, setReset] = useState(0)
  const points = useMemo(
    () => run.capture.probes.map((_, index) => probePoints({ run, index })),
    [run],
  )
  const previousPoints = useMemo(
    () =>
      previous
        ? previous.capture.probes.map((_, index) =>
            probePoints({ run: previous, index }),
          )
        : [],
    [previous],
  )
  const labels = probeLabels(run)
  const traces: Series[] = run.capture.probes.map(({ name }, i) => ({
    id: name,
    label: labels[i],
    points: points[i],
    color: i,
  }))
  const visible = traces.filter(({ id }) => !hidden.includes(id))
  const older: Series[] = previous
    ? visible.flatMap((trace) => {
        const previousIndex = previous.capture.probes.findIndex(
          ({ name, sourcePortId }) =>
            name === trace.id &&
            sourcePortId === run.capture.probes[trace.color].sourcePortId,
        )
        if (previousIndex < 0) return []
        return [
          {
            ...trace,
            id: `${trace.id}-previous`,
            points: previousPoints[previousIndex],
            dashed: true,
          },
        ]
      })
    : []
  const measured = useMemo(
    () => scopeMeasurements({ run, points }),
    [run, points],
  )
  const prior = useMemo(
    () =>
      previous
        ? scopeMeasurements({ run: previous, points: previousPoints })
        : undefined,
    [previous, previousPoints],
  )
  const end = run.capture.timestampsSeconds.at(-1)! * 1e9
  const cursors = cursorIds.map((label, index) => ({
    label,
    value: cursorPos[label] ?? end * (0.16 + index * 0.28),
    move: (value: number) =>
      setCursorPos((previous) => ({ ...previous, [label]: value })),
  }))
  const readings = cursors.map(({ value }) =>
    visible[0] ? sampleAt({ points: visible[0].points, x: value }) : undefined,
  )
  const delta = cursors[1].value - cursors[0].value
  const voltageDelta =
    readings[0] !== undefined && readings[1] !== undefined
      ? readings[1] - readings[0]
      : undefined
  if (tab === "Eye Diagram")
    return <ScopeEye run={run} points={points} labels={labels} />
  if (tab === "Measurements")
    return (
      <div className="wb-editor-scroll">
        <table className="wb-grid wb-editor-grid wb-measurements">
          <thead>
            <tr>
              {[
                "Probe",
                "Min (V)",
                "Max (V)",
                "Overshoot (mV)",
                "Undershoot (mV)",
                "Delay (ns)",
                "Rise 20–80% (ns)",
                "Fall 80–20% (ns)",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
              {prior && (
                <>
                  <th>Δ Overshoot (mV)</th>
                  <th>Δ Rise (ns)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {measured.map((row, index) => {
              const item = run.capture.probes[index]
              const previousIndex =
                previous?.capture.probes.findIndex(
                  ({ name, sourcePortId }) =>
                    name === item.name && sourcePortId === item.sourcePortId,
                ) ?? -1
              const priorRow = prior?.[previousIndex]
              return (
                <tr key={item.name}>
                  <td>{labels[index]}</td>
                  <td>{metric(row.min)}</td>
                  <td>{metric(row.max)}</td>
                  <td>{metric(row.overshootMv)}</td>
                  <td>{metric(row.undershootMv)}</td>
                  <td>{metric(row.delayNs)}</td>
                  <td>{metric(row.riseNs)}</td>
                  <td>{metric(row.fallNs)}</td>
                  {prior && (
                    <>
                      <td>
                        {row.overshootMv !== undefined &&
                        priorRow?.overshootMv !== undefined
                          ? metric(row.overshootMv - priorRow.overshootMv)
                          : "—"}
                      </td>
                      <td>
                        {row.riseNs !== undefined &&
                        priorRow?.riseNs !== undefined
                          ? metric(row.riseNs - priorRow.riseNs)
                          : "—"}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  return (
    <div className="wb-editor">
      <div className="wb-tool-row">
        {cursorIds.map((label) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={!hiddenCursors.includes(label)}
              onChange={(event) =>
                setHiddenCursors((items) =>
                  event.target.checked
                    ? items.filter((value) => value !== label)
                    : [...items, label],
                )
              }
            />{" "}
            Cursor {label}
          </label>
        ))}
        <button onClick={() => setReset((value) => value + 1)}>Zoom Fit</button>
        {previous && <output>Dashed · run #{previous.id}</output>}
      </div>
      <div className="wb-scope-split">
        <div className="wb-scope-plot">
          <Chart
            key={reset}
            scope
            series={[...older, ...visible]}
            title="Captured probe waveforms"
            xUnit="Time (ns)"
            yUnit="V"
            cursors={cursors.filter(
              ({ label }) => !hiddenCursors.includes(label),
            )}
            threshold={
              run.threshold
                ? (run.threshold.low + run.threshold.high) / 2
                : run.probes[visible[0]?.id]?.nominalHigh === undefined
                  ? undefined
                  : run.probes[visible[0].id].nominalHigh! / 2
            }
          />
        </div>
        <aside className="wb-scope-legend">
          <strong>Probes</strong>
          {traces.map((line) => {
            const range = voltageBounds(line.points)
            return (
              <label key={line.id}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(line.id)}
                  onChange={(event) =>
                    setHidden((items) =>
                      event.target.checked
                        ? items.filter((id) => id !== line.id)
                        : [...items, line.id],
                    )
                  }
                />
                <i style={{ background: seriesColor(line.color) }} />
                <span>
                  {line.label}
                  <small>{(range.max - range.min).toFixed(3)} V p-p</small>
                </span>
              </label>
            )
          })}
        </aside>
      </div>
      <div className="wb-chart-readout">
        {visible[0] && (
          <strong className="wb-cursor-reading">{visible[0].label}</strong>
        )}
        {cursors
          .filter(({ label }) => !hiddenCursors.includes(label))
          .map(({ label, value }) => (
            <span className="wb-cursor-reading" key={label}>
              {label}: {metric(value)} ns (
              {metric(readings[cursorIds.indexOf(label)])} V)
            </span>
          ))}
        {hiddenCursors.length === 0 && (
          <span>
            Δt: {metric(delta)} ns · ΔV: {metric(voltageDelta)} V · 1/|Δt|:{" "}
            {delta === 0 ? "—" : metric(1000 / Math.abs(delta))} MHz
          </span>
        )}
      </div>
    </div>
  )
}
