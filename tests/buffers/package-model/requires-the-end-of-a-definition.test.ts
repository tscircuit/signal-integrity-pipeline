import { test } from "bun:test"
import assert from "node:assert/strict"
import { parsePackageModel } from "../../../src/buffers/package-model"

import { valid } from "../../fixtures/package-matrix-ibis"

test("requires the end of a definition", () => {
  const text = valid.replace("[End Package Model]", "")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /End Package Model/,
  )
})
