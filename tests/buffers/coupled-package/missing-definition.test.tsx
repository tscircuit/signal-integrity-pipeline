import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisComponentWithPackage } from "../../../src/buffers/package-conversion"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test("rejects a missing local package definition", async () => {
  const input = packageInput(await renderPackageModel())
  const missingPackage = source.replace(
    "[Define Package Model] coupled",
    "[Define Package Model] absent",
  )
  const variantInput = {
    ...input,
    definition: { ...input.definition, source: { file: "fixture.ibs" } },
  }
  assert.throws(
    () =>
      convertIbisComponentWithPackage({
        bytes: new TextEncoder().encode(missingPackage),
        input: variantInput,
      }),
    /missing.*scalar fallback is forbidden/i,
  )
})
