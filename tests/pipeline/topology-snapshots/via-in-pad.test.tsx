import { test } from "bun:test"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"
import { viaInIntermediatePad } from "../../fixtures/topology-via-board"

test("an off-centre via in a pass-through pad", async () => {
  const { circuit, signal } = await viaInIntermediatePad()
  expectTopologySnapshot({
    circuit,
    driverReceiverChannels: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
