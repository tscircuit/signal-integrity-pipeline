import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeNet, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a supply pour under the channel does not admit its distant trace", async () => {
  const circuit = await renderCoreSignals(
    <board width={20} height={20} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="SUPPLY" y={6} extent={3} layer="bottom" />
      <trace from=".SUPPLY > .A" to="net.VDD" />
      <copperpour
        name="SUPPLY_PLANE"
        layer="bottom"
        connectsTo="net.VDD"
        unbroken
      />
    </board>,
  )
  assert(circuit.some((record) => record.type === "pcb_copper_pour"))
  const result = scopeFor({ circuit, railNets: ["VDD"] })
  assert(!result.retainedSourceIds.includes(scopeNet({ circuit, name: "VDD" })))
  assert.deepEqual(result.pcbTraceIds, result.selectedPcbTraceIds)
})
