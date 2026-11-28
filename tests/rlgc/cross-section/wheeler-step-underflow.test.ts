import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("rejects recession below representable wall displacement", () => {
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: crossSectionFixture({ kind: "stripline" }),
        options: { recessionFraction: Number.MIN_VALUE },
      }),
    { code: "cross_section_options", message: /recession displacement/i },
  )
})
