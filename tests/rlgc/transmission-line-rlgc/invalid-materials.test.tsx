import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("rejects invalid soldermask and laminate properties before solving", async () => {
  const input = await renderTransmissionLineRlgcInput()
  const defaults = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  for (const materialOverride of [
    { maskThicknessMm: -0.01 },
    { maskThicknessMm: Infinity },
    { maskRelativePermittivity: 0 },
    { maskLossTangent: NaN },
    { laminateLossTangent: -0.1 },
  ]) {
    assert.throws(
      () =>
        new TransmissionLineRlgcSolver({
          ...input,
          materials: { ...defaults, ...materialOverride },
        }),
      {
        code: "cross_section_geometry",
      },
    )
  }
})
