import { test } from "bun:test"
import assert from "node:assert/strict"
import { assertConverter } from "../../../src/buffers"
import { renderPackageModel } from "../../fixtures/package-input"

test("checks the pinned converter before compiling a declared model", async () => {
  await renderPackageModel()
  assert.throws(() => assertConverter({}), { code: "converter_version" })
})
