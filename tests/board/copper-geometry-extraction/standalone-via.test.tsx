import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import {
  CopperGeometryExtractionSolver,
  findPadContactWire,
} from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("connects a required bottom pad through a scoped standalone via", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Signal" />
        <CopperPad name="Bottom" x={0} layer="bottom" />
        <via
          connectsTo="net.SIGNAL"
          pcbX={0}
          pcbY={0}
          fromLayer="top"
          toLayer="bottom"
          outerDiameter={0.6}
          holeDiameter={0.25}
        />
      </>
    ),
  })
  const [via] = cju(circuit).pcb_via.list()
  assert(via)
  const input = getCopperGeometryExtractionInput({
    circuit,
    required: ["Bottom"],
  })
  assert(input.copperScope.extractedPcbViaIds.includes(via.pcb_via_id))
  const solver = new CopperGeometryExtractionSolver(input)
  solver.solve()
  const { geometry } = solver.getOutput().value
  const contact = geometry.padContacts.find(({ layer }) => layer === "bottom")
  assert(contact)
  const wire = findPadContactWire({ geometry, ...contact })
  assert.equal(wire?.layer, "top")
})
