import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import {
  differentialIbis,
  routedVisualIbis,
} from "../../fixtures/routed-visual-fixture"
import { Inverter } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import Differential from "../../fixtures/unit-differential"

test("attributes a late failure to the failed simulation instead of the earlier plan", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential openPositive allowUnroutedTraces>
        <Inverter name="TX2" x={-4} y={4.4} powerY={0.65} driver />
        <Inverter name="RX2" x={4} y={4.4} powerY={0.65} driver={false} />
        <trace
          from=".TX2 > .Y"
          to=".RX2 > .A"
          pcbPath={[".TX2 > .Y", ".RX2 > .A"]}
        />
        <simulation.pcbtransientchannelsimulation name="FIRST" bitRate="20Mbps">
          <simulation.pcbdriverreceiverchannel
            name="GOOD"
            driverRef=".TX2 > .Y"
            receiverRef=".RX2 > .A"
          />
        </simulation.pcbtransientchannelsimulation>
        <resistor
          name="RDRV"
          resistance="120"
          footprint="0402"
          pcbX={-7}
          connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    nearbyGapMm: 0.05,
    circuitJson,
    ibisSources: {
      [inverterModelPath]: routedVisualIbis,
      "models/sn65hvd72.ibs": differentialIbis,
    },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: /BUS: no source path/,
  })
  assert.equal(solver.stats.channelSimulationCount, 1)
  const drawing = solver.visualize()
  assert.equal(drawing.title, "RS485: can't simulate")
  assert.ok(drawing.texts?.some((text) => text.text.includes("TX pin A")))
  assert.ok(
    drawing.lines?.some(
      (line) => line.layer === "failure" && line.label?.includes("BUS+"),
    ),
  )
  assert.equal(
    drawing.lines?.some((line) => line.label?.startsWith("Trace 1 ·")),
    false,
  )
})
