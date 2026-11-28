import { cju } from "@tscircuit/circuit-json-util"
import {
  type IbisBuffer,
  type IbisDocument,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type React from "react"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"
import type { Snapshot } from "../../src/kernel"
import type { InspectorCopperScope } from "./copper"

const inlineTextPrefix = "data:text/plain"

interface InlineModel {
  document?: IbisDocument
  error?: string
}

/** Read only data embedded in Circuit JSON. No URL is requested. */
function inlineModel(url: string): InlineModel {
  if (!isInlineIbis(url)) return {}
  try {
    return { document: parseIbis(readInlineIbis(url)!) }
  } catch (cause) {
    return { error: (cause as Error).message }
  }
}

/** Decode the original bytes of an embedded model without contacting the network. */
export function readInlineIbis(url: string): string | undefined {
  if (!isInlineIbis(url)) return
  const comma = url.indexOf(",")
  const source = decodeURIComponent(url.slice(comma + 1))
  if (!url.slice(0, comma).endsWith(";base64")) return source
  return new TextDecoder().decode(
    Uint8Array.from(atob(source), (char) => char.charCodeAt(0)),
  )
}

/** Identify the inspector's inline text form without allowing network URLs. */
export function isInlineIbis(url: string): boolean {
  return (
    url.startsWith(`${inlineTextPrefix},`) ||
    (url.startsWith(`${inlineTextPrefix};`) && url.includes(","))
  )
}

/** Model names explicitly bound in Circuit JSON take precedence over a single file choice. */
export function pinModel({
  model,
  document,
  pin,
}: {
  model: Snapshot<SimulationIbisModel>
  document?: IbisDocument
  pin: string
}): string | undefined {
  const explicit = model.ibis_pin_name_to_model_name?.[pin]
  if (explicit) return explicit
  const physical =
    document?.components[model.ibis_component_name]?.pins[pin]?.model
  if (!physical) return
  const choices = document?.selectors[physical]
  if (choices?.length === 1) return choices[0]
  return physical
}

/** A labeled series of typical-corner coordinates. */
interface Curve {
  name: string
  points: [x: number, y: number][]
}

const curveColors = ["#168078", "#995129", "#326aa7", "#8d509c"]
const chartFrame = {
  width: 248,
  height: 120,
  left: 43,
  right: 10,
  top: 12,
  bottom: 24,
}

/** Chart typical-corner samples using axes shared by the series in one unit family. */
function CurveChart({
  curves,
  title,
  xUnit,
  yUnit,
}: {
  curves: Curve[]
  title: string
  xUnit: string
  yUnit: string
}): React.JSX.Element | null {
  const visible = curves.filter(({ points }) => points.length > 0)
  if (visible.length === 0) return null
  const points = visible.flatMap((curve) => curve.points)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const { width, height, left, right, top, bottom } = chartFrame
  const baseline = height - bottom
  return (
    <figure className="inspector-curve">
      <figcaption>{title}</figcaption>
      <svg
        role="img"
        aria-label={`${title}, typical corner`}
        viewBox={`0 0 ${width} ${height}`}
      >
        <path
          d={`M ${left} ${top} V ${baseline} H ${width - right}`}
          fill="none"
          stroke="#91a0ac"
        />
        <text x={left - 4} y={top + 3} textAnchor="end">
          {yMax.toPrecision(3)}
        </text>
        <text x={left - 4} y={baseline} textAnchor="end">
          {yMin.toPrecision(3)}
        </text>
        <text x={left} y={height - 7}>
          {xMin.toPrecision(3)}
        </text>
        <text x={width - right} y={height - 7} textAnchor="end">
          {xMax.toPrecision(3)}
        </text>
        <text x={(left + width - right) / 2} y={height - 7} textAnchor="middle">
          {xUnit}
        </text>
        <text x="5" y={(top + baseline) / 2}>
          {yUnit}
        </text>
        {visible.map(({ name, points }, index) => {
          const plot = points
            .map(([x, y]) =>
              [
                left +
                  ((x - xMin) / (xMax - xMin || 1)) * (width - left - right),
                baseline - ((y - yMin) / (yMax - yMin || 1)) * (baseline - top),
              ].join(","),
            )
            .join(" ")
          return (
            <polyline
              key={name}
              points={plot}
              fill="none"
              stroke={curveColors[index % curveColors.length]}
              strokeWidth="1.5"
            />
          )
        })}
      </svg>
      <div className="inspector-curve-key">
        {visible.map(({ name }, index) => (
          <span
            key={name}
            style={{ color: curveColors[index % curveColors.length] }}
          >
            {name}
          </span>
        ))}
      </div>
    </figure>
  )
}

/** Use the parser's typed table formats for both VI and VT curves. */
function BufferCharts({ buffer }: { buffer: IbisBuffer }): React.JSX.Element {
  const current = [
    { name: "Pullup", table: buffer.pullup },
    { name: "Pulldown", table: buffer.pulldown },
    { name: "Power clamp", table: buffer.powerClamp },
    { name: "Ground clamp", table: buffer.groundClamp },
  ].map(
    ({ name, table }): Curve => ({
      name,
      points: (table ?? []).flatMap(([v, i]) =>
        i === null ? [] : [[v, i * 1000]],
      ),
    }),
  )
  const voltage = buffer.waveforms.map(
    (wave, index): Curve => ({
      name: `${wave.kind} · ${wave.resistance} Ω #${index + 1}`,
      points: wave.data.map(([time, volts]) => [time * 1e9, volts]),
    }),
  )
  return (
    <div className="inspector-buffer">
      <h4>{buffer.name}</h4>
      <div className="inspector-curves">
        <CurveChart
          curves={current}
          title="Current vs. voltage"
          xUnit="V"
          yUnit="mA"
        />
        <CurveChart
          curves={voltage}
          title="Voltage vs. time"
          xUnit="ns"
          yUnit="V"
        />
      </div>
    </div>
  )
}

/** Show the board's models for pins on retained signal nets. */
export function IbisPanel({
  circuit,
  retainedSourceIds,
}: {
  circuit: CircuitJson
  retainedSourceIds: InspectorCopperScope["retainedSourceIds"]
}): React.JSX.Element {
  const db = cju([...circuit])
  const models = db.simulation_ibis_model
    .list()
    .filter((model) =>
      Object.values(model.ibis_pin_name_to_source_port_id).some((port) =>
        retainedSourceIds.has(port),
      ),
    )
  return (
    <section className="inspector-card inspector-ibis">
      <h2>IBIS models</h2>
      {models.length === 0 && (
        <p>No IBIS models are declared for the retained signal nets.</p>
      )}
      {models.map((model) => {
        const { document, error } = inlineModel(model.ibis_model_asset.url)
        const component = db.source_component.get(model.source_component_id)
        const pins = Object.entries(model.ibis_pin_name_to_source_port_id)
          .filter(([, port]) => retainedSourceIds.has(port))
          .map(([pin, port]) => ({
            pin,
            port,
            label: db.source_port.get(port)?.name ?? port,
            modelName: pinModel({ model, document, pin }),
          }))
        const buffers = document?.modelNames
          .filter((name) => pins.some(({ modelName }) => modelName === name))
          .map((name) => document.getBuffer(name))
        return (
          <details key={model.simulation_ibis_model_id} open>
            <summary>
              <strong>{component?.name ?? model.source_component_id}</strong> ·{" "}
              {model.ibis_component_name}
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Pin</th>
                  <th>Port</th>
                  <th>Model</th>
                  <th>Corner</th>
                </tr>
              </thead>
              <tbody>
                {pins.map(({ pin, port, label, modelName }) => (
                  <tr key={pin}>
                    <td>{pin}</td>
                    <td title={port}>{label}</td>
                    <td>{modelName ?? "From asset"}</td>
                    <td>Typical</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="inspector-asset">
              {model.ibis_model_asset.project_relative_path}
            </p>
            {error && (
              <p role="alert">Embedded IBIS could not be read. {error}</p>
            )}
            {!document && !error && (
              <p>Curves require IBIS data embedded in the Circuit JSON.</p>
            )}
            {buffers?.map((buffer) => (
              <BufferCharts key={buffer.name} buffer={buffer} />
            ))}
          </details>
        )
      })}
    </section>
  )
}
