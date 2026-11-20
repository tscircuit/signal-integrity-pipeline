import { test } from "bun:test"
import { daisyChain } from "../../fixtures/topology-board"
import { expectTopologySnapshot } from "../../fixtures/topology-snapshot"

test("a fly-by route through two receivers", async () => {
  const { circuit, signal } = await daisyChain({ receivers: ["MID", "RX"] })
  expectTopologySnapshot({
    circuit,
    signals: [signal],
    allowUnroutedTraces: false,
    testPath: import.meta.path,
  })
})
