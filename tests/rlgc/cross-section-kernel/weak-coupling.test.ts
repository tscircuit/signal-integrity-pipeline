import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { microstripFixture } from "../../fixtures/cross-section"
import { imageMicrostrip } from "../../fixtures/cross-section-reference"

test("weak coupling matches dielectric images", () => {
  // Small mutual C is a subtraction of empirical Hammerstad–Jensen modal coefficients; validate it against
  // a separate exact layered Green representation rather than infer a tight bound from that fit.
  let mutual = 0
  for (const [width, gap] of [
    [0.5, 2],
    [2, 2],
  ]) {
    const reference = imageMicrostrip({ width, gap, er: 4 })
    const refined = imageMicrostrip({ width, gap, er: 4, count: 48 })
    assert.ok(Math.abs(reference[0][1] / refined[0][1] - 1) < 0.001)
    const result = calculateRlgc({
      crossSection: microstripFixture({
        width,
        gap,
        er: 4,
        count: 2,
        thickness: 0.0001,
      }),
    })
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        mutual = Math.max(
          mutual,
          Math.abs(result.capacitanceFaradsPerMeter[i][j] / refined[i][j] - 1),
        )
      }
    }
  }
  assert.ok(mutual < 0.01, `independent image C entries: ${mutual}`)
})
