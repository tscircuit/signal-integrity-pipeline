import { test } from "bun:test"
import assert from "node:assert/strict"
import { signalTopology } from "../../../src/pipeline/topology"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a pull-up does not extend the signal net through its rail terminal", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <net name="VCC" />
        <resistor name="PU" resistance="10k" footprint="0402" pcbY={2} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace from=".PU > .pin1" to=".TX > .SIG" />
        <trace from=".PU > .pin2" to="net.VCC" />
      </>
    ),
  })
  const pullUp = board.circuit.find(
    (record) => record.type === "source_component" && record.name === "PU",
  )
  assert.ok(pullUp?.type === "source_component")
  const rail = board.circuit.find(
    (record) =>
      record.type === "source_port" &&
      record.source_component_id === pullUp.source_component_id &&
      record.name === "pin2",
  )
  assert.ok(rail?.type === "source_port")
  const rails = new Set([rail.source_port_id])
  assert.deepEqual(
    signalTopology({ circuit: board.circuit, rails }).bridges,
    [],
  )
  assert.doesNotThrow(() => validate({ ...board, rails }))
})
