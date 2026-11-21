import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRoutedCopper } from "../../../src/pipeline/topology-copper"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"

test("pads a fraction of a millimeter apart remain separate junctions along a wire", async () => {
  const { circuit } = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="FIRST" x={-0.3} />
        <SignalPin name="SECOND" x={0.3} />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace from=".TX > .SIG" to=".FIRST > .SIG" />
        <trace from=".TX > .SIG" to=".SECOND > .SIG" />
      </>
    ),
  })
  const ports = circuit.filter((record) => record.type === "pcb_port")
  const { graph, terminals } = buildRoutedCopper({
    circuit,
    ports,
    traces: circuit.filter((record) => record.type === "pcb_trace"),
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
  const middle = ports.filter((port) => Math.abs(port.x) < 1)
  assert.equal(middle.length, 2)
  const [first, second] = middle.map(
    (port) => terminals.get(port.source_port_id)?.[0],
  )
  assert.ok(first && second)
  assert.notEqual(first, second)
  assert.ok(graph[first].has(second))
})
