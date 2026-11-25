import { cju } from "@tscircuit/circuit-json-util"
import type {
  CircuitJson,
  SimulationPcbTransientChannelSimulation,
} from "../board"

/** Validate the shared channel simulation namespace before any independent channel simulation work. */
export function listChannelSimulations(
  circuitJson: CircuitJson,
): SimulationPcbTransientChannelSimulation[] {
  const db = cju([...circuitJson])
  const channelSimulations =
    db.simulation_pcb_transient_channel_simulation.list()
  if (
    channelSimulations.length > 1 &&
    channelSimulations.some((channelSimulation) => !channelSimulation.name)
  ) {
    const element = "<simulation.pcbtransientchannelsimulation>"
    throw new Error(
      `This board has ${channelSimulations.length} ${element} declarations; give each a name.`,
    )
  }
  const simulationPcbTransientChannelSimulationIds = new Set(
    channelSimulations.map(
      (channelSimulation) =>
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
    ),
  )
  if (
    simulationPcbTransientChannelSimulationIds.size !==
    channelSimulations.length
  )
    throw new Error(
      "Duplicate simulation_pcb_transient_channel_simulation identifier",
    )
  for (const signal of db.simulation_pcb_driver_receiver_channel.list()) {
    if (
      simulationPcbTransientChannelSimulationIds.has(
        signal.simulation_pcb_transient_channel_simulation_id,
      )
    )
      continue
    throw new Error(`${signal.name}: unknown transient channel simulation`)
  }
  return channelSimulations
}
