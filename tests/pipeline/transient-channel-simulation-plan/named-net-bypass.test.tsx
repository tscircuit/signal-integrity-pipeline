import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a named net reports its bypassed traces as a short", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg bypassFinalLeg namedNet />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  assert.throws(
    () => {
      const solver = new TransientChannelSimulationPlanSolver({
        circuitJson,
        ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
      })
      solver.solve()
      const [{ bindings }] = solver.getOutput().value
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      })
    },
    { code: "channel_short" },
  )
})
