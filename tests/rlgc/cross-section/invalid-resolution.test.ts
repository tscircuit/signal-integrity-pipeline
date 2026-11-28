import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateCapacitanceMatrix } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("electrostatic capacitance checks resolution", () => {
  const crossSection = crossSectionFixture({ kind: "microstrip", count: 1 })
  assert.throws(
    () =>
      calculateCapacitanceMatrix({
        crossSection,
        options: { panelsPerEdge: 2 },
      }),
    /panels per edge/,
  )
})
