import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("dual terminations do not send the positive receiver path down the negative leg", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential seriesPositive />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const [positive, negative] = bindings.receiverPaths
  assert.ok(positive && negative)
  assert.equal(bindings.traceContacts.length, 6)
  assert.equal(positive.sourceTraceIds?.length, 5)
  assert.ok(!positive.sourceTraceIds?.includes(negative.sourceTraceId))
})
