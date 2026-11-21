import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeNet, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a reference pour under the channel does not admit its distant trace", async () => {
  const circuit = await renderCoreSignals(
    <board width={20} height={20} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="RETURN" y={6} extent={3} layer="bottom" />
      <trace from=".RETURN > .A" to="net.GND" />
      <copperpour
        name="RETURN_PLANE"
        layer="bottom"
        connectsTo="net.GND"
        unbroken
      />
    </board>,
  )
  assert(circuit.some((record) => record.type === "pcb_copper_pour"))
  const result = scopeFor({ circuit, referenceNet: "GND" })
  assert(!result.retainedSourceIds.includes(scopeNet({ circuit, name: "GND" })))
  assert.deepEqual(result.pcbTraceIds, result.selectedPcbTraceIds)
})
