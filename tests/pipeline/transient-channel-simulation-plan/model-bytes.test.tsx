import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { sha256 } from "../../../src/kernel"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("byte inputs retain the exact model bytes", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = Buffer.from(
    `\uFEFF| Synthetic Ω fixture\r\n${routedVisualIbis}`,
  )
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: bytes },
  })
  const capturedSha256 = sha256(bytes)
  bytes[0] = 0xff
  solver.solve()
  const {
    value: [plan],
    artifacts: [manifest],
  } = solver.getOutput()
  const plannedBytes = plan.bindings.ibisSources[inverterModelPath]
  assert.ok(plannedBytes instanceof Uint8Array)
  plannedBytes[0] = 0x00
  assert.equal(
    sha256(plan.bindings.ibisSources[inverterModelPath]),
    capturedSha256,
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    capturedSha256,
  )
})
