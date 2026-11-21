import { test } from "bun:test"
import assert from "node:assert/strict"
import { seriesResistor } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("two copper legs leaving a series resistor form a branch", async () => {
  const branched = await seriesResistor({ stub: true })
  assert.throws(() => validate(branched), {
    code: "channel_fanout",
    message: /branched routes are not supported yet/,
  })
})
