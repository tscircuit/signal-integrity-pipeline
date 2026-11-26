import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import "../../fixtures/extend-expect-circuit-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("an open differential leg cannot borrow the other leg through terminations", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential openPositive allowUnroutedTraces>
        <resistor
          name="RDRV"
          resistance="120"
          footprint="0402"
          pcbX={-7}
          connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
        />
        <pcbnotetext
          text="A is open. Both ends have A-B termination."
          pcbX={0}
          pcbY={4.8}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: /BUS: no source path/,
  })
})
