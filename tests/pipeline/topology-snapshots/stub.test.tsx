import { test } from "bun:test"
import { seriesResistor } from "../../fixtures/topology-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a stub leaving a series resistor", async () => {
  const { circuit, signal } = await seriesResistor({ stub: true })
  expectTopologySnapshot({
    circuit,
    driverReceiverChannels: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
