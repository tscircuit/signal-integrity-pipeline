import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("rectangular plated pads do not extend the scope to distant nets", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire
        name="SELECTED"
        y={0}
        extent={3}
        startPad={
          <platedhole
            portHints={["pin1"]}
            pcbX={-3}
            pcbY={0}
            shape="circular_hole_with_rect_pad"
            holeDiameter={0.25}
            rectPadWidth={0.6}
            rectPadHeight={7.4}
            holeOffsetX={0}
            holeOffsetY={0}
          />
        }
      />
      <Wire name="DISTANT" y={5} extent={3} />
    </board>,
  )
  assert.equal(scopeFor({ circuit }).pcbTraceIds.length, 1)
  // The 7.4 mm pad reaches within 1.15 mm of the distant trace's end pad.
  assert.equal(scopeFor({ circuit, distanceMm: 1.3 }).pcbTraceIds.length, 2)
})
