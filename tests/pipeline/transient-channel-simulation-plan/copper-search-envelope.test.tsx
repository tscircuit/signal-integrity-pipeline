import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { Wire } from "../../fixtures/copper-scope-board"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("shows a search envelope while copper selection follows layers and reference nets", async () => {
  const circuitJson = await renderSignals({
    expectedErrors: ["pcb_port_not_connected_error"],
    tree: (
      <DaisyChainFixture
        routeFinalLeg
        boardWidthMm={100}
        allowBlindAndBuriedVias
      >
        <Wire name="DEEP" y={0.8} layer="inner2" />
        <via
          pcbX={30}
          pcbY={0}
          fromLayer="top"
          toLayer="bottom"
          connectsTo="net.GND"
        />
      </DaisyChainFixture>
    ),
  })
  const db = cju([...circuitJson])
  const pcbVia = db.pcb_via.getWhere({ x: 30 })
  const deepTrace = db.source_trace.getWhere({ name: "DEEP_route" })
  const pcbTrace = db.pcb_trace.getWhere({
    source_trace_id: deepTrace?.source_trace_id,
  })
  assert.ok(pcbVia && deepTrace && pcbTrace)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    nearbyGapMm: 1,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const { copperScope } = solver.getOutput().value[0].sections
  assert.ok(copperScope.extractedPcbViaIds.includes(pcbVia.pcb_via_id))
  assert.ok(!copperScope.extractedPcbTraceIds.includes(pcbTrace.pcb_trace_id))
  const drawing = solver.visualize()
  assert.ok(
    drawing.lines?.some(({ label }) => label === "Copper search envelope"),
  )
  assert.ok(
    drawing.lines?.some(
      ({ label }) => label === `Out of scope · ${deepTrace.source_trace_id}`,
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "copper-search-envelope",
    caption:
      "The gray inner-layer trace lies inside the search envelope. The plan retains a ground via beyond the cropped board window.",
  })
})
