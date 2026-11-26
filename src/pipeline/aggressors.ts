import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type {
  CircuitJson,
  DriverPattern,
  SimulationPcbTransientChannelSimulation,
  SourcePortId,
} from "../board"
import { type InspectedPin, pinCapabilities } from "../buffers"
import type { SignalPins } from "./signal-pins"
import { prbsPatterns } from "./timing"

/** An enabled pattern or a disabled output for each output-capable pin without a channel driver role. */
export type Aggressors = Map<SourcePortId, DriverPattern | null>

/** Identify the pin in diagnostics by the circuit's component and port names. */
function aggressorName({
  db,
  pin,
}: {
  db: CircuitJsonUtilObjects
  pin: InspectedPin
}): string {
  const component = db.source_component.get(pin.model.source_component_id)
  const port = db.source_port.get(pin.port)
  return `${component?.name ?? "unnamed component"}.${port?.name ?? pin.pin}`
}

/** Resolve the declared drive or disable state of every aggressor in source-port order. */
export function planAggressors({
  circuit,
  channelSimulation,
  pins,
  driven,
}: {
  circuit: CircuitJson
  channelSimulation: SimulationPcbTransientChannelSimulation
  pins: Map<SourcePortId, InspectedPin>
  driven: SignalPins["driven"]
}): Aggressors {
  const aggressors: Aggressors = new Map()
  const aggressorPins = [...pins.values()]
    .filter((pin) => !driven.has(pin.port) && pinCapabilities(pin).drive)
    .sort((a, b) => a.port.localeCompare(b.port, "en"))
  if (aggressorPins.length === 0) return aggressors

  const db = cju([...circuit])
  if (channelSimulation.aggressor_disabled === true) {
    for (const pin of aggressorPins) {
      if (!pinCapabilities(pin).disable) {
        const name = aggressorName({ db, pin })
        throw new Error(
          `${name}: IBIS model "${pin.buffer.name}" has no disabled state. Set aggressorPattern to drive the aggressors.`,
        )
      }
      aggressors.set(pin.port, null)
    }
    return aggressors
  }
  const pattern = channelSimulation.aggressor_pattern?.trim()
  if (!pattern) {
    const names = aggressorPins.map((pin) => aggressorName({ db, pin }))
    throw new Error(
      `Aggressors ${names.join(", ")} need a declared state. Set aggressorPattern or aggressorDisabled.`,
    )
  }
  const prbs = prbsPatterns.get(pattern)
  for (const [index, pin] of aggressorPins.entries()) {
    const signal: DriverPattern = {
      name: aggressorName({ db, pin }),
      pattern,
      bit_rate_bps: channelSimulation.bit_rate_bps,
      offset_ms: 0,
    }
    if (prbs) {
      const seedCount = 2 ** prbs.width - 1
      signal.seed = 1 + Math.floor((index * seedCount) / aggressorPins.length)
    }
    aggressors.set(pin.port, signal)
  }
  return aggressors
}
