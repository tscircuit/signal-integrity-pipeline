import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRoutedCopper } from "../../../src/pipeline/topology-copper"
import { twoRouteViaRings } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("two embedded rings remain separate junctions linked by the middle wire", async () => {
  const board = await twoRouteViaRings()
  const { circuit } = board
  const ports = circuit.filter((record) => record.type === "pcb_port")
  const { graph } = buildRoutedCopper({
    circuit,
    ports,
    traces: circuit.filter((record) => record.type === "pcb_trace"),
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
  assert.deepEqual(
    Object.values(graph)
      .map((neighbors) => neighbors.size)
      .sort(),
    [1, 1, 2, 2],
  )
  assert.doesNotThrow(() => validate(board))
})
