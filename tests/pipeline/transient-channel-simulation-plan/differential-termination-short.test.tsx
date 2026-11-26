import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("rejects an ideal short between differential termination pins", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination short="RTERM" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.traceContacts.length, 4)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    {
      domain: "simulation",
      code: "channel_short",
    },
  )
})
