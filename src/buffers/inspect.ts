import { cju } from "@tscircuit/circuit-json-util"
import {
  type IbisBuffer,
  type IbisComponent,
  type IbisDocument,
  IbisError,
  type IbisPackagePin,
  IbisReferenceError,
  type IbisReferenceVoltages,
  parseIbis,
  type ResolvedIbisReferencePorts,
  resolveIbisReferences,
  resolveIbisReferenceVoltages,
} from "@tscircuit/ibis-to-spice"
import type { CircuitJson, SimulationIbisModel, SourcePortId } from "../board"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"
import { loadModelSource } from "./source"
import type { IbisSources } from "./types"

/** The selected IBIS model, pin binding and rails for one source port. */
export type InspectedPin = {
  /** Circuit JSON source port bound to this pin. */
  port: SourcePortId
  /** Physical pin name in the IBIS component. */
  pin: IbisPackagePin["name"]
  /** Circuit JSON model declaration for the chip. */
  model: Snapshot<SimulationIbisModel>
  /** Parsed IBIS component that owns the physical pin. */
  component: IbisComponent
  /** Selected IBIS buffer model for the physical pin. */
  buffer: IbisBuffer
  /** Source ports of the separate IBIS reference rails. */
  references: ReferencePorts
}
/** Typical IBIS reference voltages for the pullup, pulldown and clamp tables. */
export type ReferenceVoltages = IbisReferenceVoltages

/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages(
  pin: Pick<InspectedPin, "buffer">,
): ReferenceVoltages {
  const { buffer } = pin
  try {
    return resolveIbisReferenceVoltages({ buffer, corner: "typical" })
  } catch (error) {
    failReferenceVoltage({ buffer, error })
  }
}

/** Translate a missing typical voltage into the pipeline diagnostic. */
function failReferenceVoltage({
  buffer,
  error,
}: {
  buffer: IbisBuffer
  error: unknown
}): never {
  if (!(error instanceof IbisError) || error.code !== "missing_corner")
    throw error
  fail("ibis_reference_voltage_missing", `${buffer.name}: ${error.message}`)
}

/** A physical IBIS pin and the Circuit JSON port that uses it. */
type PinBinding = Pick<InspectedPin, "port" | "pin" | "model" | "component">

/** Converter role names mapped to their source port IDs. */
export type ReferencePorts = ResolvedIbisReferencePorts

/** Resolve converter rail ports from the Circuit JSON binding. */
function referenceRails({
  binding,
  buffer,
}: {
  binding: PinBinding
  buffer: IbisBuffer
}): ReferencePorts {
  const { model, component, pin, port } = binding
  const explicit = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
  try {
    return resolveIbisReferences({
      component,
      pin,
      pinToSourcePort: model.ibis_pin_name_to_source_port_id,
      voltageCheck: { buffer, corner: "typical" },
      explicitReferences: {
        pullup: explicit?.pullup_reference_source_port_id,
        pulldown: explicit?.pulldown_reference_source_port_id,
        powerClamp: explicit?.power_clamp_reference_source_port_id,
        groundClamp: explicit?.ground_clamp_reference_source_port_id,
        external: explicit?.external_reference_source_port_id,
      },
    })
  } catch (error) {
    if (error instanceof IbisReferenceError) {
      if (error.reason === "ambiguous")
        fail("ibis_reference_ambiguous", `${port}: ${error.message}`)
      if (error.reason === "shorted")
        fail("ibis_reference_short", `${port}: ${error.message}`)
    }
    failReferenceVoltage({ buffer, error })
  }
}

/** IBIS pin assignments that do not select a signal buffer. */
const NON_SIGNAL_MODELS = ["power", "gnd", "nc"]

/** Selects a buffer for a physical signal pin; rail and unconnected pins have none. */
function selectedModelName({
  binding,
  selectors,
}: {
  binding: PinBinding
  selectors: IbisDocument["selectors"]
}): string | undefined {
  const { model, component, pin, port } = binding
  const physical = component.pins[pin]
  if (!physical)
    fail("ibis_pin_missing", `${port}: physical IBIS pin ${pin} is missing`)
  if (NON_SIGNAL_MODELS.includes(physical.model.toLowerCase())) return undefined

  // IBIS 7.2 §5 [Pin] names either a [Model] or a [Model Selector].
  const choices = selectors[physical.model] ?? [physical.model]
  let name = model.ibis_pin_name_to_model_name?.[pin]
  if (name === undefined && choices.length === 1) name = choices[0]
  if (!name || !choices.includes(name))
    fail(
      "ibis_model_choice",
      `${port}: choose an IBIS model from ${choices.join(", ")}`,
    )
  return name
}

/** Circuit and assets to inspect for the requested source ports. */
type PinInspectionOptions = {
  circuit: CircuitJson
  sources: IbisSources
  ports: ReadonlySet<SourcePortId>
}

/** Inspected IBIS pins keyed by the selected source port IDs. */
export type InspectedPins = Map<SourcePortId, InspectedPin>

/** Project-relative path of an IBIS model asset. */
type IbisAssetPath =
  SimulationIbisModel["ibis_model_asset"]["project_relative_path"]

/** Resolve selected signal ports and their reference rails, loading only their model declarations. */
export function inspectPins({
  circuit,
  sources,
  ports,
}: PinInspectionOptions): InspectedPins {
  const pins: InspectedPins = new Map()
  const documents = new Map<IbisAssetPath, IbisDocument>()
  const boundPorts = new Set<SourcePortId>()
  for (const model of cju([...circuit]).simulation_ibis_model.list()) {
    const selected = Object.entries(
      model.ibis_pin_name_to_source_port_id,
    ).filter(([, port]) => ports.has(port))
    if (!selected.length) continue

    const path = model.ibis_model_asset.project_relative_path
    let document = documents.get(path)
    if (!document) {
      const { text } = loadModelSource({
        model: { ...model, pipelineId: model.simulation_ibis_model_id },
        sources,
      })
      document = parseIbis(text)
      documents.set(path, document)
    }
    const component = document.components[model.ibis_component_name]
    if (!component)
      fail(
        "ibis_component_missing",
        `IBIS component ${model.ibis_component_name} is missing`,
      )
    for (const [pin, port] of selected) {
      if (boundPorts.has(port))
        fail("ibis_pin_bound_twice", `${port}: more than one IBIS pin binding`)
      boundPorts.add(port)
      const binding: PinBinding = {
        port,
        pin,
        model,
        component,
      }
      const name = selectedModelName({ binding, selectors: document.selectors })
      if (name === undefined) continue
      const buffer = document.getBuffer(name)
      pins.set(port, {
        ...binding,
        buffer,
        references: referenceRails({ binding, buffer }),
      })
    }
  }
  return pins
}

/** Whether an IBIS pin model can drive, receive or be disabled. */
export type PinCapabilities = {
  drive: boolean
  receive: boolean
  disable: boolean
}

/** Drive, receive and disable capabilities for the pinned converter’s supported IBIS model types. */
export function pinCapabilities(pin: InspectedPin): PinCapabilities {
  switch (pin.buffer.type) {
    case "input":
      return { drive: false, receive: true, disable: false }
    case "output":
      return { drive: true, receive: false, disable: false }
    case "i/o":
      return { drive: true, receive: true, disable: true }
    case "3-state":
      return { drive: true, receive: false, disable: true }
    default:
      fail(
        "ibis_capability_unsupported",
        `${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`,
      )
  }
}
