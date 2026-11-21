import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a receiver pad contained within the wire outline contacts the route", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={0} y={0.1} />
        <net name="SIGNAL" />
        <trace
          width={0.8}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 8, y: 0 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
  assert.doesNotThrow(() => validate(board))
})
