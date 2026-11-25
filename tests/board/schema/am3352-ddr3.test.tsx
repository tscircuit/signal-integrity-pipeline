import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { am3352BoardFile } from "../../../examples/am3352-ddr3/board-file"
import { type CircuitJson, validateCircuitRecords } from "../../../src/board"

test("accepts the generated AM3352 DDR3 sample board", async () => {
  const circuit: CircuitJson = JSON.parse(
    await readFile(am3352BoardFile, "utf8"),
  )
  assert.doesNotThrow(() => validateCircuitRecords(circuit))
  assert.equal(
    circuit.filter((record) => record.type === "pcb_trace").length,
    651,
  )
  assert.equal(
    circuit.filter((record) => record.type === "pcb_via").length,
    1210,
  )
})
