import { spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import { Polygon } from "@flatten-js/core"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("parallel 0.1 mm traces spaced 0.12 mm apart do not connect", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} y={0.12} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4.5, y: 0 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -4.5, y: 0 }]}
        />
      </>
    ),
  })
  const distance = spyOn(Polygon.prototype, "distanceTo")
  try {
    assert.throws(() => validate(board), { code: "channel_net" })
    assert.equal(distance.mock.calls.length, 0)
  } finally {
    distance.mockRestore()
  }
})
