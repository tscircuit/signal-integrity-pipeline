import { test } from "bun:test"
import assert from "node:assert/strict"
import { findClosestWirePoints } from "../../../src/simulation/wire-proximity"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("finds the closest points when a wire collapses to its endpoint", async () => {
  const {
    copperGeometry: { geometry },
  } = await renderTransmissionLineRlgcInput()
  const [first, second] = geometry.wires
  const nearest = findClosestWirePoints({
    firstWire: {
      startPoint: [...first.startPoint],
      endPoint: [...first.endPoint],
    },
    secondWire: {
      startPoint: [...second.startPoint],
      endPoint: [...second.startPoint],
    },
  })
  assert.equal(nearest.distanceMm, 0.35)
  assert.deepEqual(nearest.firstPoint, first.startPoint)
  assert.deepEqual(nearest.secondPoint, second.startPoint)
})
