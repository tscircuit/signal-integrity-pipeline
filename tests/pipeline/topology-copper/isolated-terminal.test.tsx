import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRoutedCopper } from "../../../src/pipeline/topology-copper"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"

test("an unrouted PCB terminal still has an isolated junction", async () => {
  const { circuit, signal } = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <trace from=".TX > .SIG" to=".RX > .SIG" />
      </>
    ),
  })
  assert.ok("source_port_id" in signal.driver)
  const ports = circuit.filter((record) => record.type === "pcb_port")
  const { graph, terminals } = buildRoutedCopper({
    circuit,
    ports,
    traces: [],
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
  const driver = terminals.get(signal.driver.source_port_id)
  assert.ok(driver)
  assert.equal(driver.length, 1)
  assert.deepEqual(graph[driver[0]], new Set())
})
