import { cju } from "@tscircuit/circuit-json-util"
import type { LayerRef } from "circuit-json"
import {
  type Dispatch,
  type JSX,
  type SetStateAction,
  useMemo,
  useState,
} from "react"
import type { CircuitJson } from "../../src/board"
import type { InspectorFeature } from "../channel-inspector/geometry"
import {
  copperOunceMm,
  editStackup,
  type StackLayer,
  stackupImpedance,
} from "./model/stackup"
import "./editors.css"

interface LayerFields {
  thickness?: number
  relative_permittivity?: number
  loss_tangent?: number
}

type LayerPatches = Record<number, LayerFields>

interface LayerEdit {
  index: number
  key: keyof LayerFields
  value: number
}

/** Update a physical layer field in the unapplied draft. */
function patchWriter(
  setPatches: Dispatch<SetStateAction<LayerPatches>>,
): (edit: LayerEdit) => void {
  return ({ index, key, value }) =>
    setPatches((items) => ({
      ...items,
      [index]: {
        ...items[index],
        [key]: Number.isFinite(value) ? value : undefined,
      },
    }))
}

const slabColors = {
  copper: "var(--near)",
  dielectric: "var(--glass)",
  soldermask: "var(--rail)",
}

/** Draw the physical order with readable copper slabs and signal/reference annotations. */
function StackupSection({
  layers,
  selected,
  signal,
  reference,
  total,
}: {
  layers: StackLayer[]
  selected: number
  signal: LayerRef
  reference?: LayerRef
  total: number
}): JSX.Element {
  const heights = layers.map((layer) => {
    const proportional =
      total > 0 ? (112 * Math.max(0, layer.thickness ?? 0)) / total : 0
    if (layer.layer_type === "copper") return Math.max(13, proportional)
    return proportional
  })
  const height = heights.reduce((sum, slab) => sum + slab, 0)
  let position = 4
  return (
    <svg
      role="img"
      aria-label="Stackup cross-section"
      viewBox={`0 0 174 ${height + 8}`}
    >
      {layers.map((layer, index) => {
        const y = position
        const slab = heights[index]
        position += slab
        let color = slabColors[layer.layer_type]
        let label: string | undefined
        if (layer.layer_type === "copper") {
          label = layer.layer
          if (layer.layer === signal) {
            label += " · signal"
            color = "var(--selected)"
          }
          if (layer.layer === reference) {
            label += " · reference"
            color = "var(--rail)"
          }
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: The physical order identifies a layer.
          <g key={index}>
            <rect
              x="5"
              y={y}
              width="52"
              height={slab}
              fill={color}
              stroke={
                selected === index ? "var(--highlight)" : "var(--outline)"
              }
              strokeWidth={selected === index ? 1.4 : 0.6}
            />
            {label && (
              <text x="63" y={y + slab / 2 + 3} fontSize="10" fill="var(--ink)">
                {label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** An editable tabular stackup with an ideal-plane impedance probe. */
export function StackupEditor({
  circuit,
  feature,
  apply,
  close,
}: {
  circuit: CircuitJson
  feature?: InspectorFeature
  apply: (circuit: CircuitJson) => void
  close: () => void
}): JSX.Element {
  const db = useMemo(() => cju([...circuit]), [circuit])
  const original = db.pcb_stackup.getWhere({})!.layers
  const [patches, setPatches] = useState<Record<number, LayerFields>>({})
  const [signalLayer, setSignalLayer] = useState<LayerRef>()
  const [referenceLayer, setReferenceLayer] = useState<LayerRef>()
  const [probeWidth, setProbeWidth] = useState<number>()
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string>()
  const wires = feature?.shapes.filter((shape) => shape.shape === "wire") ?? []
  const wire = wires[0]
  const uniformTrace =
    wire &&
    wires.every(
      ({ layers, width }) =>
        layers[0] === wire.layers[0] && width === wire.width,
    )
  const traceLength = wires.reduce(
    (sum, { start, end }) => sum + Math.hypot(end.x - start.x, end.y - start.y),
    0,
  )
  const signal = signalLayer ?? wire?.layers[0] ?? "top"
  const width = probeWidth ?? wire?.width ?? 0.2
  const copper = original.filter((layer) => layer.layer_type === "copper")
  const references = [
    ...new Set(db.pcb_copper_pour.list().map(({ layer }) => layer)),
  ].filter((layer) => layer !== signal)
  const reference = referenceLayer ?? references[0]
  const layers = useMemo(
    () =>
      original.map(
        (layer, index): StackLayer => ({ ...layer, ...patches[index] }),
      ),
    [original, patches],
  )
  const readout = useMemo(() => {
    try {
      const next = editStackup({ circuit, layers })
      return {
        data: stackupImpedance({
          circuit: next,
          signal,
          reference,
          widthMm: width,
        }),
      }
    } catch (cause) {
      return { error: (cause as Error).message }
    }
  }, [circuit, layers, signal, reference, width])
  const total = layers.reduce((sum, layer) => sum + (layer.thickness ?? 0), 0)
  const dirty = Object.keys(patches).length > 0
  const update = patchWriter(setPatches)
  return (
    <div className="wb-editor">
      <div className="wb-editor-split">
        <div className="wb-editor-scroll">
          <table className="wb-grid wb-editor-grid">
            <thead>
              <tr>
                {[
                  "#",
                  "Layer",
                  "Type",
                  "Thickness (mm)",
                  "Cu (oz)",
                  "Dk",
                  "Df",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layers.map((layer, index) => {
                const label =
                  layer.layer_type === "copper"
                    ? layer.layer
                    : layer.layer_type === "dielectric"
                      ? (layer.material_name ??
                        layer.dielectric_type ??
                        "Dielectric")
                      : "Soldermask"
                return (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: Physical layer order is its identity.
                    key={`stack-layer-${index}`}
                    aria-selected={selected === index}
                    onClick={() => setSelected(index)}
                  >
                    <td>{index + 1}</td>
                    <td>{label}</td>
                    <td>{layer.layer_type}</td>
                    <td>
                      <input
                        aria-label={`${label} thickness`}
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={layer.thickness ?? ""}
                        onChange={(event) =>
                          update({
                            index,
                            key: "thickness",
                            value: event.target.valueAsNumber,
                          })
                        }
                      />
                    </td>
                    <td>
                      {layer.layer_type === "copper" && (
                        <input
                          aria-label={`${label} copper weight`}
                          type="number"
                          min="0.001"
                          step="0.05"
                          value={Number(
                            (layer.thickness / copperOunceMm).toFixed(3),
                          )}
                          onChange={(event) =>
                            update({
                              index,
                              key: "thickness",
                              value: event.target.valueAsNumber * copperOunceMm,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {layer.layer_type !== "copper" && (
                        <input
                          aria-label={`${label} Dk`}
                          type="number"
                          min="1"
                          step="0.05"
                          value={layer.relative_permittivity ?? ""}
                          onChange={(event) =>
                            update({
                              index,
                              key: "relative_permittivity",
                              value: event.target.valueAsNumber,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {layer.layer_type === "dielectric" && (
                        <input
                          aria-label={`${label} Df`}
                          type="number"
                          min="0"
                          step="0.001"
                          value={layer.loss_tangent ?? ""}
                          onChange={(event) =>
                            update({
                              index,
                              key: "loss_tangent",
                              value: event.target.valueAsNumber,
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <aside className="wb-probe-pane">
          <StackupSection
            layers={layers}
            selected={selected}
            signal={signal}
            reference={reference}
            total={total}
          />
          <fieldset className="wb-fields">
            <legend>Impedance probe</legend>
            <label>
              Signal layer{" "}
              <select
                value={signal}
                onChange={(event) => {
                  setSignalLayer(event.target.value as LayerRef)
                  setReferenceLayer(undefined)
                }}
              >
                {copper.map(({ layer }) => (
                  <option key={layer}>{layer}</option>
                ))}
              </select>
            </label>
            <label>
              Reference plane{" "}
              <select
                value={reference ?? ""}
                onChange={(event) =>
                  setReferenceLayer(event.target.value as LayerRef)
                }
              >
                {references.length === 0 && <option value="">None</option>}
                {references.map((layer) => (
                  <option key={layer}>{layer}</option>
                ))}
              </select>
            </label>
            <label>
              Trace width (mm){" "}
              <input
                type="number"
                min="0.001"
                step="0.01"
                value={width}
                onChange={(event) =>
                  setProbeWidth(event.target.valueAsNumber || 0)
                }
              />
            </label>
            {readout.data && (
              <dl className="wb-readout">
                <dt>Single-ended Z₀</dt>
                <dd>{readout.data.ohms.toFixed(1)} Ω</dd>
                <dt>Propagation delay</dt>
                <dd>{readout.data.delayPsPerMm.toFixed(2)} ps/mm</dd>
                {uniformTrace &&
                  signal === wire.layers[0] &&
                  width === wire.width && (
                    <>
                      <dt>Trace delay</dt>
                      <dd>
                        {(traceLength * readout.data.delayPsPerMm).toFixed(2)}{" "}
                        ps
                      </dd>
                    </>
                  )}
                <dt>Effective Dk</dt>
                <dd>{readout.data.effectiveDk.toFixed(2)}</dd>
              </dl>
            )}
            {readout.error && (
              <p role="alert" className="wb-inline-error">
                {readout.error}
              </p>
            )}
            <small>
              {wire ? feature?.id : "Ideal plane at the selected layer"}
            </small>
          </fieldset>
        </aside>
      </div>
      {error && (
        <p role="alert" className="wb-inline-error">
          {error}
        </p>
      )}
      <div className="wb-editor-actions">
        <span>
          Stack thickness {total.toFixed(3)} mm
          {dirty && " · Modified — click Apply to update board"}
        </span>
        <button
          disabled={!dirty}
          onClick={() => {
            try {
              apply(editStackup({ circuit, layers }))
              setPatches({})
              setError(undefined)
            } catch (cause) {
              setError((cause as Error).message)
            }
          }}
        >
          Apply
        </button>
        <button
          onClick={() => {
            setPatches({})
            setError(undefined)
          }}
        >
          Revert
        </button>
        <button onClick={close}>Close</button>
      </div>
    </div>
  )
}
