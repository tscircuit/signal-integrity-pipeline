import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { planNetlistChannels } from "../../fixtures/channel-netlist"
import { renderSignals } from "../../fixtures/signal-render"

test("requires exactly one lowered experiment for binding", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="series">
        <simulation.pcbtransientchannelsimulation
          name="SECOND"
          bitRate="20Mbps"
          allowUnroutedTraces
        >
          <simulation.pcbdriverreceiverchannel
            name="DATA"
            driverRef=".TX > .Y"
            receiverRef=".RX > .A"
          />
        </simulation.pcbtransientchannelsimulation>
      </ChannelFixture>
    ),
  })
  const [first, second] = planNetlistChannels({ circuitJson })
  const experiments = [first, second].flatMap(({ bindings }) =>
    bindings.circuitJson.filter(({ type }) => type === "simulation_experiment"),
  )
  assert.equal(experiments.length, 2)
  const board = first.bindings.circuitJson.filter(
    ({ type }) => type !== "simulation_experiment",
  )
  for (const selected of [[], experiments]) {
    const solver = new ChannelNetlistSolver({
      ...first.bindings,
      circuitJson: [...board, ...selected],
    })
    assert.throws(() => solver.solve(), {
      code: "simulation_experiment",
      message: `simulation_experiment: Channel netlist requires exactly one experiment, got ${selected.length}`,
    })
    assert.throws(() => solver.getOutput(), /netlist is incomplete/)
  }
})
