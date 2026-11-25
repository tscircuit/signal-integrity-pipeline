import { test } from "bun:test"
import assert from "node:assert/strict"
import * as buffers from "../../../src/buffers"
import { renderPackageModel } from "../../fixtures/package-input"

test.failing(
  "checks the pinned converter before compiling a declared model",
  async () => {
    await renderPackageModel()
    const assertConverter = Reflect.get(buffers, "assertConverter")
    assert.equal(typeof assertConverter, "function")
    assert.throws(() => assertConverter({}), { code: "converter_version" })
  },
)
