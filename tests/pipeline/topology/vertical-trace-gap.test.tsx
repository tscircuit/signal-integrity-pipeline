import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("vertical 0.1 mm traces with ends 0.12 mm apart do not connect", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={0} y={-4} />
        <SignalPin name="RX" x={0} y={4} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 0, y: 3.94 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: 0, y: -3.94 }]}
        />
      </>
    ),
  })
  assert.throws(() => validate(board), { code: "channel_net" })
})
