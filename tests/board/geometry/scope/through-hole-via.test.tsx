import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("through-hole barrels reach layers beyond their connected copper", async () => {
  for (const allowBlindAndBuriedVias of [false, true]) {
    const circuit = await renderCoreSignals(
      <board
        width={18}
        height={18}
        layers={4}
        allowBlindAndBuriedVias={allowBlindAndBuriedVias}
        routeRemaining={false}
        schematicDisabled
      >
        <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
        <Wire name="NEIGHBOR" y={5} extent={3} />
        <trace from=".NEIGHBOR > .A" to="net.STUB" />
        <via
          pcbX={0}
          pcbY={0.6}
          fromLayer="top"
          toLayer="inner1"
          connectsTo="net.STUB"
        />
      </board>,
    )
    const via = circuit.find((record) => record.type === "pcb_via")
    assert(via)
    assert.deepEqual(via.layers, ["top", "inner1"])
    const neighbor = scopeTrace({ circuit, name: "NEIGHBOR" }).pcb_trace_id
    assert.equal(
      scopeFor({ circuit }).pcbTraceIds.includes(neighbor),
      !allowBlindAndBuriedVias,
    )
    // Core omits the per-via flag. Add it to test an explicit through-hole on a blind-via board.
    const throughHole = pcb_via.parse({ ...via, through_hole: true })
    const records = circuit.map((record) => {
      if (record === via) return throughHole
      return record
    })
    const scope = scopeFor({ circuit: records })
    assert(scope.pcbTraceIds.includes(neighbor))
    assert.deepEqual(scope.pcbViaIds, [via.pcb_via_id])
  }
})
