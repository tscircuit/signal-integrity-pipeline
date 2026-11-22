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
    const drawing = solver.visualize()
    const marks = drawing.polygons!.filter(
      (polygon) =>
        polygon.label &&
        polygon.points.length > 4 &&
        polygon.fill !== "#0b0f13",
    )
    assert.equal(
      marks.filter((mark) => mark.fill).length,
      2,
      "each driver is a filled dot",
    )
    assert.equal(
      marks.filter((mark) => !mark.fill).length,
      2,
      "each receiver is a ring",
    )
    assert.throws(
      () => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(),
      /scope distance/,
    )
  },
)
