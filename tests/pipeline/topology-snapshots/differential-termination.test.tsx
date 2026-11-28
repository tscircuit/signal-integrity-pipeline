import { test } from "bun:test"
import { differentialTerminationRoute } from "../../fixtures/topology-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a differential pair through a cross-leg termination", async () => {
  const { circuit, signal } = await differentialTerminationRoute()
  expectTopologySnapshot({
    circuit,
    driverReceiverChannels: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
