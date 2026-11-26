import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import {
  listChannelSimulations,
  prepareChannelSimulationById,
} from "../../../src/pipeline/signals"
import { renderTwoTracePlanInput } from "../../fixtures/two-trace-plan-input"
import { vendorAvailable, vendorModels } from "../../fixtures/vendor-models"

test.skipIf(!vendorAvailable(vendorModels.cmos.file))(
  "vendor planning uses shared channel simulation preparation",
  async () => {
    const input = await renderTwoTracePlanInput()
    const [simulationPcbTransientChannelSimulationId] = listChannelSimulations(
      input.circuitJson,
    ).map(
      (channelSimulation) =>
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
    )
    const channelSimulation = prepareChannelSimulationById({
      circuit: input.circuitJson,
      sources: input.ibisSources,
      simulationPcbTransientChannelSimulationId,
      distanceMm: input.nearbyGapMm,
    })
    const solver = new TransientChannelSimulationPlanSolver(input)
    solver.step()
    assert.equal(solver.solved, true)
    const [plan] = solver.getOutput().value
    assert.deepEqual(plan.sections.circuitJson, channelSimulation.circuit)
    assert.deepEqual(
      plan.sections.copperScope,
      channelSimulation.settings.copperScope,
    )
    assert.deepEqual(plan.warnings, [])
    assert.equal(
      solver.getOutput().value[0].sections.copperScope.channelPcbTraceIds
        .length,
      2,
    )
  },
)
