import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { SignalVia } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a barrel assigned to a rail cannot connect two selected signal stubs", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="VCC" />
        <net name="SIGNAL" />
        <SignalVia name="V" x={0} net="VCC" />
        <trace from=".TX > .SIG" to="net.VCC" />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4, y: 0 }]}
        />
        <trace
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -4, y: 0 }]}
        />
      </>
    ),
  })
  const rail = board.circuit.find(
    (record) => record.type === "source_net" && record.name === "VCC",
  )
  assert.ok(rail?.type === "source_net")
  assert.doesNotThrow(() => validate(board))
  assert.throws(
    () => validate({ ...board, rails: new Set([rail.source_net_id]) }),
    { code: "channel_net" },
  )
})
