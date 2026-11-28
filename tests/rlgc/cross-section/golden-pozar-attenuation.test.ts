import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { pozarStriplineAttenuation } from "../../fixtures/cross-section-reference"
import {
  centred,
  copper,
  POZAR_TOLERANCE,
  surface,
} from "../../fixtures/rlgc-golden"

test("golden stage 3: stripline conductor attenuation agrees with Pozar's Wheeler-derived closed form", () => {
  // (d) Pozar's alpha_c (cross-section-reference.ts) at w/b = 0.5, 1, 2: within 10% (a curve fit). Pozar gives
  // attenuation, with his zero-thickness Z0 inside the formula, so the comparison is alpha_c = R / (2 Z0) with each
  // side's own Z0. Converting Pozar's alpha_c to R with his Z0 (65.4 ohm at w/b 1, against 61.3 ohm for this
  // t/b = 0.035 strip) biased R by (Z0 ratio)^2, about 12%.
  for (const ratio of [0.5, 1, 2]) {
    const line = calculateRlgc({
      crossSection: centred({ w: ratio, b: 1, t: 0.035 }),
    })
    const solved =
      line.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
      (2 *
        Math.sqrt(
          line.externalInductanceHenriesPerMeter[0][0] /
            line.capacitanceFaradsPerMeter[0][0],
        ))
    const pozar = pozarStriplineAttenuation({
      w: ratio * 1e-3,
      b: 1e-3,
      t: 0.035e-3,
      er: 1,
      surfaceResistance: surface(copper),
    })
    console.log(`w/b ${ratio}: solver/Pozar alpha_c = ${solved / pozar}`)
    assert.ok(
      Math.abs(solved / pozar - 1) <= POZAR_TOLERANCE,
      `w/b ${ratio}: solver/Pozar ${solved / pozar}`,
    )
  }
}, 30_000)
