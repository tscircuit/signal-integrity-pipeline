import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("series resistor keeps both routed segments electrically distinct", async () => {
  const circuitJson = await renderCoreSignals(<ChannelFixture route="series" />)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings, sections } = plan
  assert.equal(sections.requiredSourcePortIds.length, 4)
  assert.equal(bindings.receiverPaths.length, 1)
  const [receiverPath] = bindings.receiverPaths
  const traces = cju(circuitJson).source_trace.list()
  const driverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(receiverPath.fromSourcePortId),
  )
  const receiverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(receiverPath.toSourcePortId),
  )
  assert.ok(driverTrace && receiverTrace)
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  for (const trace of [driverTrace, receiverTrace]) {
    const [from, to] = trace.connected_source_port_ids
    assert.notEqual(node(from), node(to), trace.source_trace_id)
  }
  assert.deepEqual(receiverPath.sourceTraceIds, [
    driverTrace.source_trace_id,
    receiverTrace.source_trace_id,
  ])
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
  })
})
