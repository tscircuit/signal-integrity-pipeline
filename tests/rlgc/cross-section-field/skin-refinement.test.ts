import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("both skin matrices refine on coupled microstrip and stripline", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const crossSection = crossSectionFixture({ kind, count: 2 })
    const base = calculateRlgc({ crossSection, options: { panelsPerEdge: 32 } })
    const fine = calculateRlgc({ crossSection, options: { panelsPerEdge: 48 } })
    for (const key of [
      "totalSkinResistanceOhmsPerMeterPerSqrtHz",
      "conductorSkinResistanceOhmsPerMeterPerSqrtHz",
    ] as const) {
      for (const [i, row] of fine[key].entries()) {
        for (const [j, coefficient] of row.entries()) {
          const change = Math.abs(base[key][i][j] / coefficient - 1)
          assert.ok(change < 0.01, `${kind} ${key} [${i},${j}]: ${change}`)
        }
      }
    }
  }
}, 20_000)
