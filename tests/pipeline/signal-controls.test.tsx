import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import type { SimulationPcbDriverReceiverChannel } from "../../src/board"
import { endpointPorts, signalBits } from "../../src/pipeline/signal-controls"
import { renderSignals } from "../fixtures/signal-render"
import Single from "../fixtures/unit-single-ended"

/** Render an explicit seed at one bit per second so the capture seconds count the bits. */
async function renderPrbsChannel(): Promise<SimulationPcbDriverReceiverChannel> {
  const circuit = await renderSignals({
    tree: <Single bitRate={1} pattern="prbs7" seed={42} />,
  })
  const signal = circuit.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  assert.ok(signal)
  return signal
}

test("PRBS7 repeats after 127 bits", async () => {
  const signal = await renderPrbsChannel()
  const bits = signalBits({ signal, durationSeconds: 127 })
  assert.equal(bits.length, 127)
  assert.equal(bits.split("1").length - 1, 64)
  assert.equal(bits, signalBits({ signal, durationSeconds: 1000 }))
})

test("PRBS7 seeds produce different sequences", async () => {
  const signal = await renderPrbsChannel()
  const bits = signalBits({ signal, durationSeconds: 127 })
  assert.notEqual(
    bits,
    signalBits({ signal: { ...signal, seed: 41 }, durationSeconds: 127 }),
  )
})

test("PRBS15 and PRBS31 fill the recording", async () => {
  const signal = await renderPrbsChannel()
  for (const pattern of ["prbs15", "prbs31"]) {
    assert.equal(
      signalBits({ signal: { ...signal, pattern }, durationSeconds: 20 })
        .length,
      20,
    )
  }
})

test("PRBS31 starts after the offset", async () => {
  const signal = {
    ...(await renderPrbsChannel()),
    pattern: "prbs31",
    offset_ms: 1e6,
  }
  assert.equal(signalBits({ signal, durationSeconds: 1002 }).length, 2)
})

test("PRBS7 rejects missing and invalid seeds", async () => {
  const signal = await renderPrbsChannel()
  assert.throws(
    () =>
      signalBits({
        signal: { ...signal, seed: undefined },
        durationSeconds: 20,
      }),
    /integer in 1..127/,
  )
  assert.throws(
    () => signalBits({ signal: { ...signal, seed: 0 }, durationSeconds: 20 }),
    /integer in 1..127/,
  )
})

test("disabled PRBS7 validates the seed", async () => {
  const signal = { ...(await renderPrbsChannel()), driver_disabled: true }
  assert.throws(
    () => signalBits({ signal: { ...signal, seed: 0 }, durationSeconds: 20 }),
    /integer in 1..127/,
  )
})

test("disabled PRBS7 stays low", async () => {
  const signal = { ...(await renderPrbsChannel()), driver_disabled: true }
  assert.equal(signalBits({ signal, durationSeconds: 20 }), "0")
})

test("literal patterns are preserved", async () => {
  const signal = await renderPrbsChannel()
  assert.equal(
    signalBits({ signal: { ...signal, pattern: "0011" }, durationSeconds: 2 }),
    "0011",
  )
  assert.equal(
    signalBits({ signal: { ...signal, pattern: "1" }, durationSeconds: 10 }),
    "1",
  )
  assert.equal(
    signalBits({ signal: { ...signal, pattern: "0" }, durationSeconds: 10 }),
    "0",
  )
})

test("clock alternates low and high", async () => {
  const signal = { ...(await renderPrbsChannel()), pattern: "clock" }
  assert.equal(signalBits({ signal, durationSeconds: 10 }), "01")
})

test("malformed literals fail", async () => {
  const signal = { ...(await renderPrbsChannel()), pattern: "10x" }
  assert.throws(() => signalBits({ signal, durationSeconds: 10 }), /pattern/)
})

test("differential ports are positive first", () => {
  assert.deepEqual(
    endpointPorts({ p_source_port_id: "p", n_source_port_id: "n" }),
    ["p", "n"],
  )
})
