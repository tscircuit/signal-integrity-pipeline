import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("uses the reference net instead of nearer signal copper", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
    reference: (
      <>
        <copperpour connectsTo="net.GND" layer="bottom" unbroken />
        <copperpour connectsTo="net.OTHER" layer="inner1" unbroken />
      </>
    ),
  })
  const db = cju(circuit)
  assert.equal(db.pcb_copper_pour.list().length, 2)
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.flatMap(({ references }) => references.map(({ layer }) => layer)),
    ["bottom"],
  )
})
