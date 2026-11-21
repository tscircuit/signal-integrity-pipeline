import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("overlapping pads carry the signal past the end of the trace", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="MID" x={3} width={1} />
        <SignalPin name="RX" x={3.75} width={1} />
        <net name="SIGNAL" />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 6.7, y: 0 }]}
        />
        <trace from=".MID > .SIG" to="net.SIGNAL" />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
  assert.doesNotThrow(() => validate(board))
})
