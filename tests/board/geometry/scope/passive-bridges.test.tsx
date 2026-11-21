import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  renderScopeBoard,
  scopeFor,
  scopeNet,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"

test("passive bridges extend a nearby signal but stop at supply and reference nets", async () => {
  const circuit = await renderScopeBoard(
    <board width={25} height={24} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="NEAR" y={0.6} extent={3} />
      <Wire name="FAR" y={6} extent={3} />
      <Wire name="LAST" y={9} extent={3} />
      <resistor name="R2" resistance="33" footprint="0402" pcbX={8} pcbY={7} />
      <resistor name="R1" resistance="33" footprint="0402" pcbX={8} pcbY={4} />
      <resistor
        name="RG"
        resistance="10k"
        footprint="0402"
        pcbX={8}
        pcbY={-4}
      />
      <resistor
        name="RV"
        resistance="10k"
        footprint="0402"
        pcbX={8}
        pcbY={-6}
      />
      <trace from=".R1 > .pin1" to=".NEAR > .B" />
      <trace from=".R1 > .pin2" to=".FAR > .A" />
      <trace from=".R2 > .pin1" to=".FAR > .B" />
      <trace from=".R2 > .pin2" to=".LAST > .A" />
      <trace from=".RG > .pin1" to=".NEAR > .A" />
      <trace from=".RG > .pin2" to="net.GND" />
      <trace from=".RV > .pin1" to=".NEAR > .A" />
      <trace from=".RV > .pin2" to="net.VDD" />
    </board>,
  )
  const result = scopeFor({ circuit, referenceNet: "GND", railNets: ["VDD"] })
  assert.deepEqual(
    result.pcbTraceIds,
    ["SELECTED", "NEAR", "FAR", "LAST"].map(
      (name) => scopeTrace({ circuit, name }).pcb_trace_id,
    ),
  )
  for (const name of ["GND", "VDD"])
    assert(!result.retainedSourceIds.includes(scopeNet({ circuit, name })))
})
