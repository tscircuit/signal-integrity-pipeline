import { test } from "bun:test"
import { padContactRoute } from "../../fixtures/topology-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a straight trace from the driver pad to the receiver pad", async () => {
  const { circuit, signal } = await padContactRoute({ offset: 0 })
  expectTopologySnapshot({
    circuit,
    signals: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
