import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("uses the full barrel span on a board without blind vias", async () => {
  const circuit = await renderCopperGeometryBoard({
    allowBlindAndBuriedVias: false,
    children: (
      <>
        <CopperTrace name="Signal" startLayer="inner2" />
        <CopperPad name="Contact" x={0} />
        <via
          connectsTo="net.SIGNAL"
          pcbX={0}
          pcbY={0}
          fromLayer="top"
          toLayer="inner1"
          outerDiameter={0.6}
          holeDiameter={0.25}
        />
      </>
    ),
  })
  const [via] = cju(circuit).pcb_via.list()
  assert(via)
  assert(!via.layers.includes("inner2"))
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Contact"] }),
  )
  solver.solve()
  const { vias } = solver.getOutput().value.geometry
  assert(
    vias
      .find(({ pcbViaId }) => pcbViaId === via.pcb_via_id)
      ?.layers.includes("inner2"),
  )
})
