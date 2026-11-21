import { test } from "bun:test"
import assert from "node:assert/strict"
import { parseSpiceVectors } from "../../src/observation"

test("native vectors without a real ASCII header are a waveform diagnostic", () => {
  assert.throws(() => parseSpiceVectors(""), { code: "waveform" })
})
