import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("rejects a PRBS string that exceeds the runtime representation", async () => {
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
        <Inverter name="RX" x={5} y={0} driver={false} />
        <Reference />
        <trace
          from=".TX > .Y"
          to=".RX > .A"
          pcbPath={[".TX > .Y", ".RX > .A"]}
        />
        <simulation.pcbtransientchannelsimulation
          bitRate="20Mbps"
          duration="30s"
        >
          <simulation.pcbdriverreceiverchannel
            name="DATA"
            driverRef=".TX > .Y"
            receiverRef=".RX > .A"
            pattern="prbs31"
            seed={1}
          />
        </simulation.pcbtransientchannelsimulation>
      </board>
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), /prbs31 pattern exceeds .* bits/)
  const header = solver
    .visualize()
    .texts?.filter(({ layer }) => layer === "header")
    .toSorted((a, b) => b.y - a.y)
    .map(({ text }) => text)
    .join(" ")
  assert.match(header || "", /Signal "DATA": prbs31 pattern exceeds .* bits/)
})
