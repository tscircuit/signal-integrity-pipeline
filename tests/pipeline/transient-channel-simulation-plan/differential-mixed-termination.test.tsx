import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { selectPort } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import "../../fixtures/extend-expect-circuit-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("mixed routed and ideal terminations cannot carry an open differential leg", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential
        openPositive
        routedTermination="positive"
        allowUnroutedTraces
      >
        <resistor
          name="RDRV"
          resistance="120"
          footprint="0402"
          pcbX={-7}
          pcbRotation={180}
        />
        <trace
          from=".TX > .A"
          to=".RDRV > .pin1"
          width={0.2}
          pcbPath={[".TX > .A", ".RDRV > .pin1"]}
        />
        <trace from=".TX > .B" to=".RDRV > .pin2" />
        <pcbnotetext
          text="A open. Both loads use A copper and B ideal."
          fontSize={0.45}
          pcbX={0}
          pcbY={4.8}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  assert.equal(cju([...circuitJson]).pcb_trace.list().length, 3)
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const driver = selectPort({
    circuit: circuitJson,
    selector: { component: "TX", port: "A" },
  })
  const receiver = selectPort({
    circuit: circuitJson,
    selector: { component: "RX", port: "A" },
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: new RegExp(
      `BUS: no source path from ${driver.source_port_id} to ${receiver.source_port_id}`,
    ),
  })
})
