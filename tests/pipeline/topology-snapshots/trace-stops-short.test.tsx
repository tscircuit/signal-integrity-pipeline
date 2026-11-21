import { test } from "bun:test"
import { collinearTraceGap } from "../../fixtures/topology-gap-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a trace that stops short of the other trace", async () => {
  const { circuit, signal } = await collinearTraceGap()
  expectTopologySnapshot({
    circuit,
    signals: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
