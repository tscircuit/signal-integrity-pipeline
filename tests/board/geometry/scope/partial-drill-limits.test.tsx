import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import { scopeFor, scopeNet, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("an explicit top drill limit preserves the connected inner layer of a blind via", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={22}
      height={18}
      layers={4}
      allowBlindAndBuriedVias
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={9} layer="inner2" />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="top"
        toLayer="inner1"
        connectsTo="net.NEIGHBOR"
      />
    </board>,
  )
  const net = scopeNet({ circuit, name: "NEIGHBOR" })
  const via = circuit.find(
    (record) => record.type === "pcb_via" && record.source_net_id === net,
  )
  assert(via?.type === "pcb_via")
  const limited = pcb_via.parse({ ...via, topmost_drill_layer: "top" })
  const records = circuit.map((record) => {
    if (record === via) return limited
    return record
  })
  assert(scopeFor({ circuit: records }).pcbViaIds.includes(via.pcb_via_id))
})
