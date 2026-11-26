import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { sha256 } from "../../../src/kernel"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("planning captures and hashes unused IBIS bytes without decoding them", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const unusedPath = "models/unused.ibs"
  const unusedBytes = new Uint8Array([0xff])
  const capturedHash = sha256(unusedBytes)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: {
      "models/sn74lvc1g04.ibs": routedVisualIbis,
      [unusedPath]: unusedBytes,
    },
  })
  unusedBytes[0] = 0x00
  solver.solve()
  const {
    artifacts: [manifest],
  } = solver.getOutput()
  assert.equal(JSON.parse(manifest.body).models[unusedPath], capturedHash)
})
