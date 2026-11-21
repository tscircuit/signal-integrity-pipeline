import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a via without a net is ignored within reach of the channel", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={16} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <via pcbX={0} pcbY={0.5} fromLayer="top" toLayer="bottom" />
    </board>,
  )
  const vias = circuit.filter((record) => record.type === "pcb_via")
  assert.equal(vias.length, 1)
  assert.equal(vias[0].source_net_id, undefined)
  assert.equal(vias[0].source_trace_id, undefined)
  assert.equal(vias[0].pcb_trace_id, undefined)
  assert.deepEqual(scopeFor({ circuit }).pcbViaIds, [])
})
