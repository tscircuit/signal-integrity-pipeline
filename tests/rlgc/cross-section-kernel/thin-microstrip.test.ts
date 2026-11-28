import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { LIGHT_SPEED, microstripFixture } from "../../fixtures/cross-section"
import { singleMicrostrip } from "../../fixtures/cross-section-reference"

test("thin microstrip matches Hammerstad–Jensen", () => {
  let maximum = 0
  for (const width of [0.25, 1, 3]) {
    for (const er of [2.2, 4, 10]) {
      const expected = singleMicrostrip({ u: width, er })
      const result = calculateRlgc({
        crossSection: microstripFixture({
          width,
          gap: 0,
          er,
          count: 1,
          thickness: 0.0001,
        }),
      })
      const C = Math.sqrt(expected.ee) / (LIGHT_SPEED * expected.z)
      const L = (expected.z * Math.sqrt(expected.ee)) / LIGHT_SPEED
      maximum = Math.max(
        maximum,
        Math.abs(result.capacitanceFaradsPerMeter[0][0] / C - 1),
        Math.abs(result.externalInductanceHenriesPerMeter[0][0] / L - 1),
      )
    }
  }
  assert.ok(maximum < 0.02, `single C/L sweep: ${maximum}`)
})
