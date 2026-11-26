import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("keeps both receiver paths and their SPICE nodes on the two-trace example", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
    nearbyGapMm: 1,
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  assert.deepEqual(sections.copperScope.channelPcbTraceIds, [
    "pcb_trace_0",
    "pcb_trace_1",
  ])
  const nodes = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  assert.deepEqual(
    bindings.receiverPaths.map(
      ({
        channelName: port,
        sourceTraceId,
        fromSourcePortId: from,
        toSourcePortId: to,
      }) => ({
        port,
        sourceTraceId,
        driverNode: nodes.node(from),
        receiverNode: nodes.node(to),
      }),
    ),
    [
      {
        port: "DATA",
        sourceTraceId: "source_trace_6",
        driverNode: "n2",
        receiverNode: "n6",
      },
      {
        port: "VICTIM",
        sourceTraceId: "source_trace_13",
        driverNode: "n11",
        receiverNode: "n14",
      },
    ],
  )
})
