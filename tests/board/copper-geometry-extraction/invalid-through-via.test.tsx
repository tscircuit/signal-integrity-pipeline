import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("rejects a through via with a layer outside the board stack", async () => {
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
          toLayer="inner3"
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Contact"] }),
  )
  assert.throws(() => solver.solve(), /via .* unknown copper layer inner3/)
})
