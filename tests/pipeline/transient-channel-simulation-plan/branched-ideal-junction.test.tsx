import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("successive routed branches share one transitive ideal junction", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg branched />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const [driverTraceContacts, ...branchTraceContacts] = bindings.traceContacts
  assert.equal(branchTraceContacts.length, 2)
  const junction = node(driverTraceContacts.toSourcePortId)
  assert.notEqual(node(driverTraceContacts.fromSourcePortId), junction)
  for (const contacts of branchTraceContacts) {
    assert.ok(
      [node(contacts.fromSourcePortId), node(contacts.toSourcePortId)].includes(
        junction,
      ),
    )
  }
  assert.deepEqual(
    bindings.receiverPaths.map(
      ({ sourceTraceIds }) => sourceTraceIds?.length ?? 1,
    ),
    [1, 2, 2],
  )
})
