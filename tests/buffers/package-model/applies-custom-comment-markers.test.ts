import { test } from "bun:test"
import assert from "node:assert/strict"
import { parsePackageModel } from "../../../src/buffers/package-model"

import { valid } from "../../fixtures/package-matrix-ibis"

test("applies custom comment markers", () => {
  const comment = valid.replace("7 -0.5n", "7 -0.5n # ignored column")
  const changedMarker = valid.replace(
    "[Model Data]",
    "[Comment Char] #_char\n[Model Data]",
  )
  const globalComment = parsePackageModel({
    text: `[Comment Char] #_char\n${comment}`,
    name: "Example package",
  })
  assert.deepEqual(globalComment.pins, ["Z9", "A1", "7"])
  const changedComment = parsePackageModel({
    text: `[Comment Char] |_char\n${changedMarker}`,
    name: "Example package",
  })
  assert.deepEqual(changedComment.pins, ["Z9", "A1", "7"])
})
