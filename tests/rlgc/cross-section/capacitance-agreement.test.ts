import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateCapacitanceMatrix, calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("electrostatic and full capacitance agree", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const crossSection = crossSectionFixture({ kind, count: 2 })
    assert.deepEqual(
      calculateCapacitanceMatrix({ crossSection }),
      calculateRlgc({ crossSection }).capacitanceFaradsPerMeter,
    )
  }
}, 30_000)
