import type React from "react"
import type { CircuitJson } from "../../src/board"
import type { IbisSources } from "../../src/buffers"
import {
  RoutedPipelineSolver,
  type TransientChannelSimulationPlan,
} from "../../src/pipeline"
import {
  listChannelSimulations,
  type PreparedChannelSimulation,
  prepareChannelSimulationById,
} from "../../src/pipeline/signals"
import { renderCoreSignals } from "../support/core-render"

/** Render through real core, permitting only specifically expected physical diagnostics. */
export async function renderSignals({
  tree,
  expectedErrors = [],
}: {
  tree: React.ReactElement
  expectedErrors?: string[]
}): Promise<CircuitJson> {
  try {
    return await renderCoreSignals(tree)
  } catch (error) {
    const records = (error as { circuitJson?: CircuitJson }).circuitJson
    if (
      !records?.some(
        (record) => record.type === "simulation_pcb_driver_receiver_channel",
      )
    )
      throw error
    const errors = records.filter((record) => record.type.endsWith("_error"))
    if (
      errors.length > 0 &&
      errors.every((record) => expectedErrors.includes(record.type))
    )
      return records
    throw error
  }
}

/** Lower every transient channel simulation in board order, as TransientChannelSimulationPlanSolver does one channel simulation per step. */
export function prepareChannelSimulations({
  circuit,
  sources,
  distanceMm,
}: {
  circuit: CircuitJson
  sources: IbisSources
  distanceMm?: number
}): PreparedChannelSimulation[] {
  return listChannelSimulations(circuit).map((channelSimulation) =>
    prepareChannelSimulationById({
      circuit,
      sources,
      simulationPcbTransientChannelSimulationId:
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
      distanceMm,
    }),
  )
}

/** Gets the first channel simulation's bindings through the public solver. */
export function plannedBindings({
  circuitJson,
  ibisSources,
}: {
  circuitJson: CircuitJson
  ibisSources: IbisSources
}): TransientChannelSimulationPlan["bindings"] {
  const root = new RoutedPipelineSolver({
    input: { circuitJson, ibisSources },
    context: {
      runSolver: async () => {
        throw new Error("channel planning needs no native solver")
      },
      progress: () => undefined,
    },
  })
  root.solveUntilStage("CopperGeometryExtractionSolver")
  return root.stageOutput("TransientChannelSimulationPlanSolver").value[0]
    .bindings
}
