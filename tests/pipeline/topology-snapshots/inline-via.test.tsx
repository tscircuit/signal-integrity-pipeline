import { test } from "bun:test"
import { inlineVia } from "../../fixtures/topology-contact-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a trace that changes layer through an inline via", async () => {
  const { circuit, signal } = await inlineVia()
  expectTopologySnapshot({
    circuit,
    signals: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
