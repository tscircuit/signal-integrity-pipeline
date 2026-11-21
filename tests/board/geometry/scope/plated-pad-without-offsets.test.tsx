import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby plated pad is retained when core omits its hole offsets", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <chip
        name="NEAR"
        pcbY={0.8}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              shape="circular_hole_with_rect_pad"
              holeDiameter={0.25}
              rectPadWidth={0.6}
              rectPadHeight={0.6}
            />
          </footprint>
        }
      />
    </board>,
  )
  const pad = circuit.find((record) => record.type === "pcb_plated_hole")
  assert(pad?.shape === "circular_hole_with_rect_pad")
  assert.equal(pad.hole_offset_x, undefined)
  assert.equal(pad.hole_offset_y, undefined)
  assert(pad.pcb_port_id)
  const port = circuit.find(
    (record) =>
      record.type === "pcb_port" && record.pcb_port_id === pad.pcb_port_id,
  )
  assert(port?.type === "pcb_port")
  assert(scopeFor({ circuit }).retainedSourceIds.includes(port.source_port_id))
})
