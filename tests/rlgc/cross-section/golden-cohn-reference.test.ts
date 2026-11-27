import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { stripline } from "../../fixtures/cross-section-reference"
import {
  COHN_DEFAULT_TOLERANCE,
  COHN_FINE_TOLERANCE,
  centred,
  cohnErrors,
} from "../../fixtures/rlgc-golden"

test("golden stage 3: Cohn exact stripline C and Z0 over w/b", () => {
  // Reference: Cohn (1954) exact conformal map, Z0 = eta0/(4 sqrt(er)) K(k)/K(k'), k = sech(pi w/2b)
  // (cross-section-reference.ts). The solver needs t > 0: t/b = 5e-4 raises C slightly (Cohn's thick-strip
  // fringing term). Tolerances: 1% at the default 12 panels/edge, the solver's own claimed mesh convergence
  // (12 -> 16 change < 1%, asserted above); 0.5% at 24 panels. The region is homogeneous: no interface truncation.
  const rows: Record<string, number>[] = []
  const failures: string[] = []
  for (const ratio of [0.25, 0.5, 1, 2, 4]) {
    const exact = stripline({ w: ratio, b: 1, er: 4 })
    const errors = cohnErrors({ ratio, panels: [6, 8, 12, 16, 24] })
    const line = calculateRlgc({
      crossSection: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
    })
    const zError = Math.abs(
      Math.sqrt(
        line.externalInductanceHenriesPerMeter[0][0] /
          line.capacitanceFaradsPerMeter[0][0],
      ) /
        exact.z -
        1,
    )
    rows.push({
      wOverB: ratio,
      exactZ0: +exact.z.toFixed(3),
      z0ErrorPercent: +(100 * zError).toFixed(4),
      ...Object.fromEntries(
        [...errors].map(([panels, value]) => [
          `cErrorPercent@${panels}`,
          +(100 * value).toFixed(4),
        ]),
      ),
    })
    if (!(errors.get(12)! <= COHN_DEFAULT_TOLERANCE)) {
      failures.push(`w/b ${ratio}: C error ${errors.get(12)} at 12 panels > 1%`)
    }
    if (!(zError <= COHN_DEFAULT_TOLERANCE))
      failures.push(`w/b ${ratio}: Z0 error ${zError} > 1%`)
    if (!(errors.get(24)! <= COHN_FINE_TOLERANCE)) {
      failures.push(
        `w/b ${ratio}: C error ${errors.get(24)} at 24 panels > 0.5%`,
      )
    }
  }
  console.table(rows)
  assert.deepEqual(failures, [])
}, 30_000)
