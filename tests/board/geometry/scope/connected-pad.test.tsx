import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("a connected nearby pad admits its source net without a routed trace", async () => {
  const { scope, circuit } = await scopeNeighbors()
  const net = circuit.find(
    (record) => record.type === "source_net" && record.name === "FLOATING",
  )
  assert(net?.type === "source_net")
  assert(scope.retainedSourceIds.includes(net.source_net_id))
})
