import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("planning rejects a transient step that underflows to zero", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const driverModel = routedVisualIbis
    .split("[Rising Waveform]")[0]
    .replaceAll("1.98/1n", "1.98/5e-324")
  const receiverModel = routedVisualIbis.slice(
    routedVisualIbis.indexOf("[Model] LVC1G04_IN_33"),
  )
  const ibisSources = { [inverterModelPath]: driverModel + receiverModel }
  assert.throws(
    () =>
      new TransientChannelSimulationPlanSolver({
        circuitJson,
        ibisSources,
      }).solve(),
    /Transient timestep must be finite and positive.*time_per_step/,
  )
})
