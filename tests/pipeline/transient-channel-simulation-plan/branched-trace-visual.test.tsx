import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { simulation } from "@tscircuit/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("shows the reason when a routed trace has more than two contacts", async () => {
  const sourcePortRefs = [".TX > .Y", ".RX > .A", ".LOAD > .A"]
  const circuitJson = await renderSignals({
    tree: (
      <board
        width={18}
        height={12}
        layers={4}
        thickness={1.6}
        fabricatorPreset="jlcpcb_standard"
        routeRemaining={false}
        schematicDisabled
        isViaInPadAllowed
      >
        <Inverter name="TX" x={-5} y={0} driver />
        <Inverter name="RX" x={0} y={0} driver={false} />
        <Inverter name="LOAD" x={5} y={0} driver={false} />
        <Reference />
        <trace name="BRANCH" path={sourcePortRefs} pcbPath={sourcePortRefs} />
        <simulation.pcbtransientchannelsimulation bitRate="20Mbps">
          <simulation.pcbdriverreceiverchannel
            name="DATA"
            driverRef={sourcePortRefs[0]}
            receiverRef={sourcePortRefs.slice(1)}
          />
        </simulation.pcbtransientchannelsimulation>
      </board>
    ),
    expectedErrors: ["pcb_port_not_connected_error", "pcb_trace_error"],
  })
  const db = cju([...circuitJson])
  const sourceTrace = db.source_trace.getWhere({ name: "BRANCH" })
  assert.equal(sourceTrace?.connected_source_port_ids.length, 3)
  assert.ok(
    db.pcb_trace.getWhere({ source_trace_id: sourceTrace?.source_trace_id }),
  )
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), { code: "channel_fanout" })
  const drawing = solver.visualize()
  assert.ok(
    drawing.texts?.some(({ text }) =>
      text.includes("branched routes are not supported"),
    ),
  )
  assert.ok(
    drawing.texts?.some(({ text }) => text.includes("× branched trace")),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "branched-trace-visual",
  })
})
