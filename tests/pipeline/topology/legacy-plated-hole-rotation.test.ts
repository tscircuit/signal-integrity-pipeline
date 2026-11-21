import { test } from "bun:test"
import assert from "node:assert/strict"
import { rotatedPlatedHole } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a saved plated-hole pad can take its rotation from the component", async () => {
  const board = await rotatedPlatedHole()
  // Core always writes the pad rotation. Older exports store it only on the component.
  const circuit = board.circuit.map((record) => {
    if (
      record.type !== "pcb_plated_hole" ||
      record.shape !== "hole_with_polygon_pad"
    )
      return record
    const { ccw_rotation, ...legacyPad } = record
    assert.equal(ccw_rotation, 90)
    return legacyPad
  })
  assert.doesNotThrow(() => validate({ ...board, circuit }))
})
