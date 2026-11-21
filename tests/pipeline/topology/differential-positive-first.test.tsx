import { test } from "bun:test"
import assert from "node:assert/strict"
import { SignalPin, topologyBoard } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("strict routing reports an open positive leg before the negative leg", async () => {
  const board = await topologyBoard({
    driverRef: { p: ".TXP > .SIG", n: ".TXN > .SIG" },
    receiverRef: { p: ".RXP > .SIG", n: ".RXN > .SIG" },
    children: (
      <>
        <SignalPin name="TXP" x={-4} y={1} />
        <SignalPin name="TXN" x={-4} y={-1} />
        <SignalPin name="RXP" x={4} y={1} />
        <SignalPin name="RXN" x={4} y={-1} />
        <trace from=".TXP > .SIG" to=".RXP > .SIG" />
        <trace from=".TXN > .SIG" to=".RXN > .SIG" />
      </>
    ),
  })
  assert.throws(() => validate(board), {
    code: "channel_net",
    message: /between TXP\.SIG and RXP\.SIG/,
  })
})
