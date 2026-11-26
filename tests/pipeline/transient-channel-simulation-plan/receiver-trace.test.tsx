import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("a routed receiver segment survives an ideal driver segment", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  const [pcbTraceId] = sections.copperScope.channelPcbTraceIds
  const trace = cju(circuitJson).pcb_trace.get(pcbTraceId)
  assert.ok(trace?.type === "pcb_trace" && trace.source_trace_id)
  assert.equal(sections.copperScope.channelPcbTraceIds.length, 1)
  assert.deepEqual(
    bindings.receiverPaths.map((receiverPath) => receiverPath.sourceTraceId),
    [trace.source_trace_id],
  )
})
