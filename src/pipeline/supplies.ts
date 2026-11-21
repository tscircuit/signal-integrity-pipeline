import type { SimulationVoltageSource } from "circuit-json"
import {
  type ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import type { CircuitJson, SourceNetId, SourcePortId } from "../board"
import { type InspectedPin, referenceVoltages } from "../buffers"
import { type SimulationModeling, voltageSourceTerminals } from "../simulation"

/** Allowed difference between typical IBIS voltages on one reference net. */
const REFERENCE_VOLTAGE_TOLERANCE_V = 1e-8

interface ReferenceBias {
  port: SourcePortId
  voltage: number
}

interface BlockSupplyOptions {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  pins: Map<SourcePortId, InspectedPin>
  retained: ReadonlySet<SourcePortId | SourceNetId>
  reference: SourcePortId
  settings: SimulationModeling
}

/** Canonical connectivity-map net, or the original port/net for an isolated endpoint. */
function netKey({
  connectivity,
  id,
}: {
  connectivity: ConnectivityMap
  id: SourcePortId | SourceNetId
}): string {
  return connectivity.getNetConnectedToId(id) ?? id
}

/** Retained voltage sources and all their terminal nets, including the shared reference. */
interface RetainedSupplies {
  sources: Set<SimulationVoltageSource>
  sourceNets: Set<SourceNetId>
}

/** Include sources reachable from the retained nets without traversing the shared reference. */
function retainedVoltageSources({
  circuit,
  connectivity,
  pins,
  retained,
  reference,
}: BlockSupplyOptions): RetainedSupplies {
  const candidates = circuit
    .filter((record) => record.type === "simulation_voltage_source")
    .map((source) => {
      const terminals = voltageSourceTerminals(source)
      const nets = terminals
        .filter((id) => id !== undefined)
        .map((id) => netKey({ connectivity, id }))
      return { source, nets }
    })
  const seeds = new Set([...retained].map((id) => netKey({ connectivity, id })))
  for (const pin of pins.values()) {
    for (const port of Object.values(pin.references)) {
      if (port !== undefined) seeds.add(netKey({ connectivity, id: port }))
    }
  }
  const ground = netKey({ connectivity, id: reference })
  seeds.delete(ground)
  const connections = candidates.map(({ nets }) =>
    nets.filter((net) => net !== ground),
  )
  const groups = Object.values(findConnectedNetworks(connections))
  const reachable = new Set(
    groups.filter((nets) => nets.some((net) => seeds.has(net))).flat(),
  )
  const sources = new Set<SimulationVoltageSource>()
  const sourceNets = new Set<SourceNetId>()
  for (const candidate of candidates) {
    if (!candidate.nets.some((net) => reachable.has(net))) continue
    sources.add(candidate.source)
    for (const net of candidate.nets) sourceNets.add(net)
  }
  return { sources, sourceNets }
}

/** Retain declared sources and infer a nominal supply only for an unpowered IBIS rail. */
export function addBlockSupplies(options: BlockSupplyOptions): void {
  const { circuit, connectivity, pins, reference, settings } = options
  const { sources, sourceNets } = retainedVoltageSources(options)
  for (const source of circuit.filter(
    (record) => record.type === "simulation_voltage_source",
  )) {
    if (!sources.has(source)) circuit.splice(circuit.indexOf(source), 1)
  }
  const ground = netKey({ connectivity, id: reference })
  const netVoltages = new Map<string, ReferenceBias>()
  const externalPorts = new Set<SourcePortId>()
  for (const pin of pins.values()) {
    const voltages = referenceVoltages(pin)
    const ports = pin.references
    if (ports.external) externalPorts.add(ports.external)
    const roles = Object.keys(voltages) as Array<keyof typeof voltages>
    for (const role of roles) {
      const voltage = voltages[role]
      const port = ports[role]
      if (!Number.isFinite(voltage))
        throw new Error(
          `${pin.port}: invalid typical ${role} reference voltage.`,
        )
      const key = netKey({ connectivity, id: port })
      const previous = netVoltages.get(key)
      if (
        previous &&
        Math.abs(previous.voltage - voltage) > REFERENCE_VOLTAGE_TOLERANCE_V
      ) {
        throw new Error(
          `${pin.port}: shared reference has incompatible IBIS typical voltages.`,
        )
      }
      if (!previous) netVoltages.set(key, { port, voltage })
    }
  }
  for (const port of externalPorts) {
    const key = netKey({ connectivity, id: port })
    if (key === ground || netVoltages.has(key) || sourceNets.has(key)) continue
    throw new Error(
      `${port}: external IBIS reference has no declared or nominal bias.`,
    )
  }
  for (const [key, { port, voltage }] of netVoltages) {
    if (key === ground && Math.abs(voltage) > REFERENCE_VOLTAGE_TOLERANCE_V) {
      throw new Error(
        `${port}: nonzero IBIS reference shares the channel ground.`,
      )
    }
    if (key === ground) continue
    if (sourceNets.has(key)) continue
    settings.supplies ??= []
    settings.supplies.push({
      positive: { sourcePortId: port },
      negative: { sourcePortId: reference },
      voltageV: voltage,
    })
  }
}
