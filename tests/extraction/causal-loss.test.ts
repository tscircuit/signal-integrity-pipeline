import { test } from "bun:test"
import assert from "node:assert/strict"
import { causalLossPoles, causalLossResponse } from "../../src/extraction"

test("keeps the loss poles and weights positive", () => {
  assert.ok(
    causalLossPoles().every(
      (pole) => pole.rate > 0 && pole.skin > 0 && pole.dielectric > 0,
    ),
  )
})

test("fits positive-real loss over the DDR edge band", () => {
  for (let i = 0; i <= 100; i++) {
    const frequency = 1e7 * 500 ** (i / 100)
    const response = causalLossResponse({ frequency })
    assert.ok(Math.abs(response.skinReal / Math.sqrt(frequency) - 1) < 0.05)
    assert.ok(
      Math.abs(response.dielectricReal / (2 * Math.PI * frequency) - 1) < 0.06,
    )
    assert.ok(response.skinImaginary > 0 && response.dielectricCapacitance > 0)
  }
})
