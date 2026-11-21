import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor } from "../../../fixtures/copper-scope-board"
import { PlatedPadSpanBoard } from "../../../fixtures/plated-pad-span-board"
import { renderCoreSignals } from "../../../support/core-render"

test("the same plated pad stays outside the channel scope at zero rotation", async () => {
  const circuit = await renderCoreSignals(<PlatedPadSpanBoard rotation={0} />)
  const pad = circuit.find((record) => record.type === "pcb_plated_hole")
  assert(pad?.shape === "hole_with_polygon_pad")
  assert.equal(pad.ccw_rotation, 0)
  assert(pad.pcb_port_id)
  const port = circuit.find(
    (record) =>
      record.type === "pcb_port" && record.pcb_port_id === pad.pcb_port_id,
  )
  assert(port?.type === "pcb_port")
  assert(!scopeFor({ circuit }).retainedSourceIds.includes(port.source_port_id))
})
