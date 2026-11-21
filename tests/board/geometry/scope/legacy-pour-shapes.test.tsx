import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_copper_pour } from "circuit-json"
import type { CircuitJson } from "../../../../src/board"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("rectangular and polygonal pours admit a net only within the lateral cap", async () => {
  const circuit = await renderCoreSignals(
    <board width={20} height={20} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="LINKED" y={6} extent={3} />
      <trace from=".LINKED > .A" to="net.PLANE" />
      <copperpour name="POUR" layer="top" connectsTo="net.PLANE" unbroken />
    </board>,
  )
  const pour = circuit.find((record) => record.type === "pcb_copper_pour")
  assert(pour?.shape === "brep")
  const linked = scopeTrace({ circuit, name: "LINKED" }).pcb_trace_id
  // Core only renders BREP pours. Re-encode the rendered record using other schema variants.
  for (const y of [1, 3]) {
    const variants = [
      pcb_copper_pour.parse({
        ...pour,
        shape: "rect",
        center: { x: 0, y },
        width: 2,
        height: 0.5,
      }),
      pcb_copper_pour.parse({
        ...pour,
        shape: "polygon",
        points: [
          { x: -1, y: y - 0.25 },
          { x: 1, y: y - 0.25 },
          { x: 0, y: y + 0.25 },
        ],
      }),
    ]
    for (const variant of variants) {
      const records: CircuitJson = circuit.map((record) => {
        if (record === pour) return variant
        return record
      })
      assert.equal(
        scopeFor({ circuit: records }).pcbTraceIds.includes(linked),
        y === 1,
      )
    }
  }
})
