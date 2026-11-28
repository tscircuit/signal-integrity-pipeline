import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"

test("limits recession across a narrow gap", () => {
  const close = calculateRlgc({
    crossSection: {
      conductors: [
        {
          conductorId: "a",
          xMm: 0,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
        {
          conductorId: "b",
          xMm: 0.1002,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
      ],
      planes: [{ zMm: 0 }],
      dielectricLayers: [],
    },
  })
  assert.ok(close.diagnostics.recessionMm < 0.0002 / 4)
})
