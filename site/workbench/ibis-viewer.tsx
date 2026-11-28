import {
  type IbisBuffer,
  type IbisCorner,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import { type JSX, useMemo, useState } from "react"
import type { CircuitJson } from "../../src/board"
import type { IbisFocus } from "./assign-models"
import { Chart, type Datum, type Series, sampleAt, seriesColor } from "./chart"
import {
  displayAsset,
  displayBuffer,
  displayDirection,
  embeddedModels,
  ibisBaseline,
  ibisDriveScale,
  resetIbisModel,
  tuneIbisModel,
} from "./model/ibis"
import { corners } from "./model/ibis-text"
import { fixed } from "./model/labels"

/** Current and voltage curve series for the selected IBIS corners. */
interface IbisSeries {
  currents: Series[]
  voltages: Series[]
}

/** Convert the parsed buffer's current and fixture tables to display units. */
function ibisSeries({
  buffer,
  corner,
}: {
  buffer: IbisBuffer
  corner: IbisCorner | "all"
}): IbisSeries {
  const tables = [
    { label: "Pullup", table: buffer.pullup },
    { label: "Pulldown", table: buffer.pulldown },
    { label: "Power clamp", table: buffer.powerClamp },
    { label: "Ground clamp", table: buffer.groundClamp },
  ]
  const selected = corner === "all" ? corners : [corner]
  const currents: Series[] = []
  const voltages: Series[] = []
  for (const value of selected) {
    const index = corners.indexOf(value)
    for (const [color, { label, table }] of tables.entries()) {
      const points = (table ?? [])
        .flatMap((row): Datum[] => {
          const amount = row[index + 1]
          if (amount == null) return []
          return [[row[0], amount * 1000]]
        })
        .sort((a, b) => a[0] - b[0])
      if (!points.length) continue
      currents.push({
        id: `${label}-${value}`,
        label: corner === "all" ? `${label} · ${value}` : label,
        points,
        color,
        dashed: index > 0,
      })
    }
    for (const [color, wave] of buffer.waveforms.entries()) {
      const label = `${wave.kind === "rising" ? "Rising" : "Falling"} · ${wave.resistance} Ω @ ${wave.fixtureVoltage[index] ?? "—"} V`
      const points = wave.data.flatMap((row): Datum[] => {
        const volts = row[index + 1]
        if (volts == null) return []
        return [[row[0] * 1e9, volts]]
      })
      if (!points.length) continue
      voltages.push({
        id: `${wave.kind}-${color}-${value}`,
        label: corner === "all" ? `${label} · ${value}` : label,
        points,
        color,
        dashed: index > 0,
      })
    }
  }
  return { currents, voltages }
}

/** Present one adjustable model chart with a live cursor and trace legend. */
function IbisPlot({
  series,
  title,
  xTitle,
  xUnit,
  yUnit,
}: {
  series: Series[]
  title: string
  xTitle: string
  xUnit: string
  yUnit: string
}): JSX.Element {
  const [x, setX] = useState<number>()
  const [hidden, setHidden] = useState<string[]>([])
  const visible = series.filter(({ id }) => !hidden.includes(id))
  return (
    <section className="wb-ibis-plot">
      <h3>{title}</h3>
      <div className="wb-ibis-chart">
        <Chart
          series={visible}
          title={title}
          xUnit={xTitle}
          yUnit={yUnit}
          onHover={setX}
        />
      </div>
      <div className="wb-plot-legend">
        {series.map((line) => {
          const y =
            x === undefined ? undefined : sampleAt({ points: line.points, x })
          return (
            <label key={line.id} style={{ color: seriesColor(line.color) }}>
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
              {line.label}
              {y !== undefined && ` ${y.toPrecision(4)} ${yUnit}`}
            </label>
          )
        })}
      </div>
      <output className="wb-chart-readout">
        {x === undefined
          ? "Drag to zoom · Double-click to fit"
          : `X: ${fixed({ value: x, digits: 2 })} ${xUnit}`}
      </output>
    </section>
  )
}

/** Inspect and modify embedded IBIS buffers with process-corner waveform views. */
export function IbisViewer({
  circuit,
  original,
  initial,
  apply,
}: {
  circuit: CircuitJson
  original: CircuitJson
  initial?: IbisFocus
  apply: (circuit: CircuitJson) => void
}): JSX.Element {
  const models = useMemo(() => embeddedModels(circuit), [circuit])
  const loadedModels = useMemo(() => embeddedModels(original), [original])
  const [modelId, setModel] = useState(initial?.modelId)
  const [bufferName, setBuffer] = useState(initial?.buffer)
  const [corner, setCorner] = useState<IbisCorner | "all">("typical")
  const [scale, setScale] = useState<number>()
  const [cap, setCap] = useState<number>()
  const [reset, setReset] = useState(0)
  const [error, setError] = useState<string>()
  const model =
    models.find(({ record }) => record.simulation_ibis_model_id === modelId) ??
    models[0]
  const names = model?.document?.modelNames ?? []
  const name = names.find((value) => value === bufferName) ?? names[0]
  const buffer = name && model?.document?.getBuffer(name)
  const baseline = useMemo(() => {
    if (!model || !name) return
    const loaded = loadedModels.find(
      ({ record }) =>
        record.simulation_ibis_model_id ===
        model.record.simulation_ibis_model_id,
    )
    return ibisBaseline({ model, loaded, name })
  }, [model, name, loadedModels])
  const appliedScale = useMemo(() => {
    if (baseline && buffer && name)
      return ibisDriveScale({
        buffer,
        baseline: parseIbis(baseline).getBuffer(name),
      })
    return 1
  }, [baseline, buffer, name])
  const curves = useMemo(
    () => buffer && ibisSeries({ buffer, corner }),
    [buffer, corner],
  )
  return (
    <div className="wb-editor wb-ibis">
      <div className="wb-tool-row">
        <label>
          Component{" "}
          <select
            value={model?.record.simulation_ibis_model_id ?? ""}
            onChange={(event) => {
              setModel(event.target.value)
              setScale(undefined)
              setBuffer(undefined)
              setCap(undefined)
              setError(undefined)
            }}
          >
            {models.map((item) => (
              <option
                key={item.record.simulation_ibis_model_id}
                value={item.record.simulation_ibis_model_id}
              >
                {item.component}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model{" "}
          <select
            value={name ?? ""}
            onChange={(event) => {
              setBuffer(event.target.value)
              setCap(undefined)
              setScale(undefined)
              setError(undefined)
            }}
          >
            {names.map((item) => (
              <option key={item} value={item}>
                {displayBuffer(item)}
              </option>
            ))}
          </select>
        </label>
        <span className="wb-separator" />
        {([...corners, "all"] as const).map((value, index) => (
          <button
            key={value}
            aria-pressed={corner === value}
            onClick={() => setCorner(value)}
          >
            {["Typ", "Min", "Max", "All"][index]}
          </button>
        ))}
        <button onClick={() => setReset((value) => value + 1)}>
          Reset Zoom
        </button>
      </div>
      <div className="wb-tool-row">
        <label>
          Drive Scale{" "}
          <input
            aria-label="Drive Scale"
            type="number"
            min="0.5"
            max="2"
            step="0.05"
            value={scale ?? appliedScale}
            onChange={(event) => setScale(event.target.valueAsNumber || 0)}
          />
          ×
        </label>
        <label>
          C_comp (pF){" "}
          <input
            aria-label="C_comp (pF)"
            type="number"
            min="0"
            step="0.1"
            value={
              cap ??
              (buffer && buffer.capacitance[0] !== null
                ? Number((buffer.capacitance[0] * 1e12).toPrecision(6))
                : "")
            }
            onChange={(event) => setCap(event.target.valueAsNumber || 0)}
          />
        </label>
        <button
          disabled={
            !name ||
            ((scale === undefined || scale === appliedScale) &&
              cap === undefined)
          }
          onClick={() => {
            if (!name || !model) return
            try {
              apply(
                tuneIbisModel({
                  circuit,
                  model,
                  name,
                  scale,
                  driveRatio:
                    scale === undefined ? undefined : scale / appliedScale,
                  capacitancePf: cap,
                }),
              )
              setCap(undefined)
              setScale(undefined)
              setError(undefined)
            } catch (cause) {
              setError((cause as Error).message)
            }
          }}
        >
          Apply to Model
        </button>
        <button
          onClick={() => {
            setCap(undefined)
            setScale(undefined)
            setError(undefined)
          }}
        >
          Clear Pending Edits
        </button>
        <button
          disabled={!baseline || !buffer}
          onClick={() => {
            if (!baseline || !model || !name) return
            try {
              apply(resetIbisModel({ circuit, model, baseline, name }))
              setCap(undefined)
              setScale(undefined)
              setError(undefined)
            } catch (cause) {
              setError((cause as Error).message)
            }
          }}
        >
          Reset Model
        </button>
      </div>
      {(error || model?.error) && (
        <p role="alert" className="wb-inline-error">
          {error ?? model?.error}
        </p>
      )}
      {curves && (
        <div className="wb-ibis-plots" key={`${name}-${corner}-${reset}`}>
          <IbisPlot
            series={curves.currents}
            title="V–I Curves"
            xTitle="IBIS Table Voltage (V)"
            xUnit="V"
            yUnit="mA"
          />
          <IbisPlot
            series={curves.voltages}
            title="V–t Waveforms"
            xTitle="Time (ns)"
            xUnit="ns"
            yUnit="V"
          />
        </div>
      )}
      {!models.length && (
        <p className="wb-placeholder">
          No IBIS models are declared in this design.
        </p>
      )}
      {buffer && (
        <div className="wb-tool-row wb-chart-readout">
          Type: {displayDirection(buffer.type)} · Voltage range:{" "}
          {buffer.voltage?.[0] ?? "—"} V · C_comp:{" "}
          {buffer.capacitance[0] == null
            ? "—"
            : Number((buffer.capacitance[0] * 1e12).toPrecision(6))}{" "}
          pF · Asset: {model && displayAsset(model.record)}
        </div>
      )}
    </div>
  )
}
