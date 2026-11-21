import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a selected physical via seeds proximity without a selected trace or pad", async () => {
  const circuit = await renderCoreSignals(
    <board width={20} height={16} routeRemaining={false} schematicDisabled>
      <via
        pcbX={0}
        pcbY={0}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.CHANNEL"
        outerDiameter={0.6}
        holeDiameter={0.3}
      />
      <Wire name="NEAR" y={1.3} extent={5} />
      <Wire name="FAR" y={-1.6} extent={5} />
    </board>,
  )
  const result = scopeFor({ circuit, selectedNet: "CHANNEL" })
  assert.deepEqual(result.selectedPcbTraceIds, [])
  assert.deepEqual(result.pcbTraceIds, [
    scopeTrace({ circuit, name: "NEAR" }).pcb_trace_id,
  ])
  const via = circuit.find((record) => record.type === "pcb_via")
  assert(via)
  assert.deepEqual(result.pcbViaIds, [via.pcb_via_id])
})
