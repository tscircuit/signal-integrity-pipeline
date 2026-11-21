import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby via barrel with explicit drill limits retains its otherwise distant net", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={18}
      layers={4}
      allowBlindAndBuriedVias
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <Wire name="DISTANT" y={5} extent={3} />
      <trace from=".DISTANT > .A" to="net.NEIGHBOR" />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="top"
        toLayer="inner1"
        connectsTo="net.NEIGHBOR"
      />
    </board>,
  )
  const via = circuit.find((record) => record.type === "pcb_via")
  assert(via)
  assert.deepEqual(via.layers, ["top", "inner1"])
  const shallow = scopeFor({ circuit })
  assert.deepEqual(shallow.pcbViaIds, [])
  assert.equal(shallow.pcbTraceIds.length, 1)

  // The TSX via supplies connected layers. Add the independent drill limits in Circuit JSON.
  for (const limits of [
    { topmost_drill_layer: "top", bottommost_drill_layer: "bottom" },
    { bottommost_drill_layer: "inner2" },
  ]) {
    const barrel = pcb_via.parse({ ...via, ...limits })
    const records = circuit.map((record) => {
      if (record === via) return barrel
      return record
    })
    const deep = scopeFor({ circuit: records })
    assert.deepEqual(deep.pcbViaIds, [via.pcb_via_id])
    assert.equal(deep.pcbTraceIds.length, 2)
  }
})
