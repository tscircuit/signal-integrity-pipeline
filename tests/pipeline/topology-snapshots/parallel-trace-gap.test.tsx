import { test } from "bun:test"
import { parallelTraceGap } from "../../fixtures/topology-gap-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("parallel traces separated by a gap", async () => {
  const { circuit, signal } = await parallelTraceGap()
  expectTopologySnapshot({
    circuit,
    signals: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
