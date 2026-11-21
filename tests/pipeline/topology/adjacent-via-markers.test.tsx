import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("consecutive route vias do not imply a wire between their barrels", async () => {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[
            ".TX > .SIG",
            { x: 3, y: 0, via: true, fromLayer: "top", toLayer: "bottom" },
            { x: 5, y: 0, via: true, fromLayer: "bottom", toLayer: "top" },
            ".RX > .SIG",
          ]}
        />
      </>
    ),
  })
  assert.throws(() => validate(board), { code: "channel_net" })
})
