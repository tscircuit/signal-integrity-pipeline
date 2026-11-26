import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { Wire } from "../../fixtures/copper-scope-board"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("shows a channel pour and the copper it reaches in the search envelope", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <DaisyChainFixture routeFinalLeg boardWidthMm={100}>
        <trace from=".TX > .Y" to="net.DATA" />
        <copperpour
          name="CHANNEL_POUR"
          layer="top"
          connectsTo="net.DATA"
          unbroken
          outline={[
            { x: -5.4, y: -5.05 },
            { x: -3.8, y: -5.05 },
            { x: -3.8, y: 0.4 },
            { x: -5.4, y: 0.4 },
          ]}
        />
        <Wire name="NEAR_POUR" x={-4.9} y={-5.4} extent={0.4} />
      </DaisyChainFixture>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const db = cju([...circuitJson])
  const trace = db.source_trace.getWhere({ name: "NEAR_POUR_route" })
  assert.ok(trace)
  const pcbTrace = db.pcb_trace.getWhere({
    source_trace_id: trace.source_trace_id,
  })
  assert.ok(pcbTrace)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    nearbyGapMm: 1,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ sections }] = solver.getOutput().value
  assert.ok(
    sections.copperScope.extractedPcbTraceIds.includes(pcbTrace.pcb_trace_id),
  )
  const drawing = solver.visualize()
  const envelope = drawing.lines?.filter(
    ({ label }) => label === "Copper search envelope",
  )
  assert.ok(envelope?.some(({ points }) => points.some(({ y }) => y <= -5.8)))
  assert.ok(
    drawing.lines?.some(
      ({ label }) => label === `Nearby signal · ${trace.source_trace_id}`,
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "pour-search-envelope",
  })
})
