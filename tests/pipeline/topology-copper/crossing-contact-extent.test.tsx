import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRoutedCopper } from "../../../src/pipeline/topology-copper"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"

test("a pad at the edge of a diagonal crossing shares the crossing junction", async () => {
  const { circuit } = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="CROSS" x={-2} y={-1} />
        <SignalPin name="EDGE" x={0.51} y={-0.14} width={0.08} />
        <net name="SIGNAL" />
        <trace
          width={0.4}
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          width={0.2}
          from=".CROSS > .SIG"
          to="net.SIGNAL"
          pcbPath={[".CROSS > .SIG", { x: 4, y: 2 }]}
        />
        <trace from=".EDGE > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
  const ports = circuit.filter((record) => record.type === "pcb_port")
  const edge = ports.find((port) => port.x === 0.51)
  assert.ok(edge)
  const { graph, terminals } = buildRoutedCopper({
    circuit,
    ports,
    traces: circuit.filter((record) => record.type === "pcb_trace"),
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
  const pad = terminals.get(edge.source_port_id)
  assert.ok(pad)
  assert.equal(graph[pad[0]].size, 4)
})
