import { test } from "bun:test"
import { daisyChain } from "../../fixtures/topology-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a T-branch at a pass-through pin", async () => {
  const { circuit, signal } = await daisyChain({
    receivers: ["RX"],
    branch: true,
  })
  expectTopologySnapshot({
    circuit,
    driverReceiverChannels: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
