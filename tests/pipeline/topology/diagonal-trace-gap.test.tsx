import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("intersecting bounds do not connect separated wire caps", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} y={0.09} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4, y: 0 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.91, y: 0 }]}
        />
      </>
    ),
  })
  assert.throws(() => validate(board), { code: "channel_net" })
})
