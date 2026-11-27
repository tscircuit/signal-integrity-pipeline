import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateCapacitanceMatrix } from "../../../src/rlgc"
import { stripline } from "../../fixtures/cross-section-reference"
import { COHN_REFINEMENT_FLOOR, centred } from "../../fixtures/rlgc-golden"

test("golden stage 3: Cohn stripline error shrinks from 6 to 24 panels per edge", () => {
  // Same reference as above, on a thinner strip. At t/b = 5e-4 the error plateaus near 0.26% (w/b 0.25): that is the
  // strip's thickness bias against Cohn's zero-thickness answer, larger than the 0.2% floor first declared. Declared
  // before this run: at t/b = 1e-5 the bias scales (t ln(1/t)) to ~0.007%, so the 24-panel error must not exceed
  // the 6-panel error unless both are under a 0.02% floor.
  const failures = [0.25, 0.5, 1, 2, 4].flatMap((ratio) => {
    const exact = stripline({ w: ratio, b: 1, er: 4 }).capacitance
    const [coarse, fine] = [6, 24].map((count) => {
      const section = centred({ w: ratio, b: 1, t: 1e-5, er: 4 })
      const capacitance = calculateCapacitanceMatrix({
        crossSection: section,
        options: { panelsPerEdge: count },
      })[0][0]
      return Math.abs(capacitance / exact - 1)
    })
    console.log(
      `w/b ${ratio}: |C/C_cohn - 1| = ${(100 * coarse).toFixed(4)}% (6) -> ${(100 * fine).toFixed(4)}% (24)`,
    )
    if (fine <= Math.max(coarse, COHN_REFINEMENT_FLOOR)) return []
    return [`w/b ${ratio}: ${coarse} (6) -> ${fine} (24)`]
  })
  assert.deepEqual(failures, [])
}, 30_000)
