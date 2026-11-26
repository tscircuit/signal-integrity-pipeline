import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("rejects an ideal channel bypass across a routed series channel", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.traceContacts.length, 2)
  assert.equal(bindings.receiverPaths[0]?.sourceTraceIds?.length, 2)
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
