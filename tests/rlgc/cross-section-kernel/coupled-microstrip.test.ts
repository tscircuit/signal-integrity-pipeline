import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { LIGHT_SPEED, microstripFixture } from "../../fixtures/cross-section"
import { coupledMicrostrip } from "../../fixtures/cross-section-reference"

test("coupled modes match Hammerstad–Jensen", () => {
  let modal = 0
  for (const width of [0.5, 1, 2]) {
    for (const gap of [0.2, 0.5, 2]) {
      const expected = coupledMicrostrip({ width, gap, er: 4 })
      const result = calculateRlgc({
        crossSection: microstripFixture({
          width,
          gap,
          er: 4,
          count: 2,
          thickness: 0.001,
        }),
      })
      for (const [sign, ee, z] of [
        [1, expected.ee, expected.ze],
        [-1, expected.eo, expected.zo],
      ]) {
        const C =
          result.capacitanceFaradsPerMeter[0][0] +
          sign * result.capacitanceFaradsPerMeter[0][1]
        const L =
          result.externalInductanceHenriesPerMeter[0][0] +
          sign * result.externalInductanceHenriesPerMeter[0][1]
        modal = Math.max(
          modal,
          Math.abs(C / (Math.sqrt(ee) / (LIGHT_SPEED * z)) - 1),
          Math.abs(L / ((z * Math.sqrt(ee)) / LIGHT_SPEED) - 1),
          Math.abs(Math.sqrt(L / C) / z - 1),
          Math.abs((Math.sqrt(L * C) * LIGHT_SPEED) / Math.sqrt(ee) - 1),
        )
      }
    }
  }
  assert.ok(modal < 0.02, `coupled C/L/Z/delay sweep: ${modal}`)
})
