import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import {
  ReceiverModels,
  receiverModelSources,
} from "../../fixtures/receiver-models"
import { renderCoreSignals } from "../../support/core-render"

test("maps both declarations of the same receiver to one routed trace and SPICE node", async () => {
  const circuitJson = await renderCoreSignals(
    <ReceiverModels secondModel="LVC1G04_IN_33" />,
  )
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: receiverModelSources,
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.traceContacts.length, 1)
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
      ["source_trace_6", "n2", "n6"],
      ["source_trace_6", "n2", "n6"],
    ],
  )
})
