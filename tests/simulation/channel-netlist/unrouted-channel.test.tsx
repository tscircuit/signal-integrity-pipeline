import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { plannedBindings, renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("publishes an allowed unrouted channel with no trace contacts", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const bindings = plannedBindings({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.equal(bindings.traceContacts.length, 0)
  const solver = new ChannelNetlistSolver(bindings)
  solver.solve()
  assert.doesNotThrow(() => solver.getOutput())
})
