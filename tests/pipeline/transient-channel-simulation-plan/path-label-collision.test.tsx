import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import {
  differentialIbis,
  routedVisualIbis,
} from "../../fixtures/routed-visual-fixture"
import { Inverter } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("keeps paths from separate declarations with the same display label apart", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential
        seriesPositive
        allowUnroutedTraces
        additionalChannels={
          <simulation.pcbdriverreceiverchannel
            name="BUS+"
            driverRef=".TX2 > .Y"
            receiverRef=".RX2 > .A"
          />
        }
      >
        <Inverter name="TX2" x={-6} y={4.4} powerY={0.65} driver />
        <Inverter name="RX2" x={6} y={4.4} powerY={0.65} driver={false} />
        <trace
          from=".TX2 > .Y"
          to=".RX2 > .A"
          pcbPath={[".TX2 > .Y", ".RX2 > .A"]}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: {
      "models/sn65hvd72.ibs": differentialIbis,
      "models/sn74lvc1g04.ibs": routedVisualIbis,
    },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.ok(
    drawing.texts?.some(({ text }) =>
      text.includes("BUS+: TX2 pin Y → RX2 pin A"),
    ),
  )
  assert.ok(
    drawing.texts?.some(({ text }) =>
      text.includes("BUS+: TX pin A → RX pin A (5 traces,"),
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "path-label-collision",
  })
})
