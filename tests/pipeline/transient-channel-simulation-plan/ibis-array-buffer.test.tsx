import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("a referenced ArrayBuffer fails the shared IBIS input type check", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = new TextEncoder().encode(routedVisualIbis)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: {
      "models/sn74lvc1g04.ibs": bytes.buffer as unknown as Uint8Array,
    },
  })
  assert.throws(() => solver.step(), {
    domain: "buffers",
    code: "ibis_asset",
    message: /expected a string or Uint8Array/,
  })
})
