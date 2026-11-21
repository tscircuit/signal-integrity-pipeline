import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("the upper drill stub of a buried via reaches a top-layer channel", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={18}
      layers={4}
      allowBlindAndBuriedVias
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="inner2"
        toLayer="bottom"
        connectsTo="net.NEIGHBOR"
      />
    </board>,
  )
  const via = circuit.find((record) => record.type === "pcb_via")
  assert(via)
  assert.deepEqual(via.layers, ["inner2", "bottom"])
  assert.deepEqual(scopeFor({ circuit }).pcbViaIds, [])

  // Core emits the connected layers. The drill can extend above them.
  const barrel = pcb_via.parse({ ...via, topmost_drill_layer: "inner1" })
  const records = circuit.map((record) => {
    if (record === via) return barrel
    return record
  })
  assert.deepEqual(scopeFor({ circuit: records }).pcbViaIds, [via.pcb_via_id])
})
