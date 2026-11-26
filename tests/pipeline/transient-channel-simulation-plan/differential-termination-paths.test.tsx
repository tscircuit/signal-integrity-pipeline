import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("keeps four physical traces and maps only the two declared differential receivers", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.deepEqual(
    bindings.traceContacts.map((contacts) => contacts.sourceTraceId),
    ["source_trace_6", "source_trace_8", "source_trace_9", "source_trace_7"],
  )
  const nodes = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  assert.deepEqual(
    bindings.receiverPaths.map(
      ({ sourceTraceId, fromSourcePortId: from, toSourcePortId: to }) => [
        sourceTraceId,
        nodes.node(from),
        nodes.node(to),
      ],
    ),
    [
      ["source_trace_6", "n1", "n6"],
      ["source_trace_7", "n2", "n7"],
    ],
  )
})
