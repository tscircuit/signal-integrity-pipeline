import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRoutedCopper } from "../../../src/pipeline/topology-copper"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"

test("chained overlap makes one physical junction along a wire", async () => {
  const { circuit } = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="FIRST" x={-1} y={0.4} width={2} />
        <SignalPin name="BRIDGE" x={0.25} y={-0.4} width={1.5} />
        <SignalPin name="LAST" x={0.8} y={0.4} />
        <trace
          width={1.4}
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace from=".TX > .SIG" to=".FIRST > .SIG" />
        <trace from=".TX > .SIG" to=".BRIDGE > .SIG" />
        <trace from=".TX > .SIG" to=".LAST > .SIG" />
      </>
    ),
  })
  const ports = circuit.filter((record) => record.type === "pcb_port")
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const { terminals } = buildRoutedCopper({
    circuit,
    ports,
    traces,
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
  const contacts = ports.filter((port) => port.x > -4 && port.x < 4)
  assert.equal(contacts.length, 3)
  const junctions = contacts.flatMap((port) => {
    const junction = terminals.get(port.source_port_id)
    assert.ok(junction)
    return junction
  })
  assert.equal(new Set(junctions).size, 1)
})
