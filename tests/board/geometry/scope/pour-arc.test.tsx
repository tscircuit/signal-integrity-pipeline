import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_copper_pour } from "circuit-json"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a pour arc approaching the channel is retained even when its vertices are distant", async () => {
  const outline = [
    { x: 4.5, y: 2 },
    { x: 6, y: 2 },
    { x: 6, y: -2 },
    { x: 4.5, y: -2 },
  ]
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <copperpour
        name="CURVED"
        layer="top"
        connectsTo="net.ARC"
        unbroken
        outline={outline}
      />
    </board>,
  )
  const pour = circuit.find((record) => record.type === "pcb_copper_pour")
  assert(pour?.shape === "brep")
  const net = pour.source_net_id
  assert(net)
  assert(!scopeFor({ circuit }).retainedSourceIds.includes(net))

  // Add curved-edge metadata that the TSX pour outline does not accept yet.
  for (const bulge of [0.375, -0.375]) {
    const vertices = [...outline.slice(0, -1), { ...outline[3], bulge }]
    const curved = pcb_copper_pour.parse({
      ...pour,
      brep_shape: { outer_ring: { vertices }, inner_rings: [] },
    })
    const records = circuit.map((record) => {
      if (record === pour) return curved
      return record
    })
    const result = scopeFor({ circuit: records })
    assert.equal(result.retainedSourceIds.includes(net), bulge < 0)
  }
})
