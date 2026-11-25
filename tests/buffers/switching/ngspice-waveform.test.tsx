import { test } from "bun:test"
import assert from "node:assert/strict"
import { interpolate } from "@tscircuit/ibis-to-spice"
import { createNativeSolver } from "../../../src/adapters"
import { splitWords } from "../../../src/buffers/source-tokens"
import { subcircuitHeader } from "../../../src/buffers/spice-netlist"

import {
  convert,
  run,
  type SpiceSamples,
  switchingInput,
} from "../../fixtures/switching"

test("matches the full waveform in ngspice", async () => {
  const input = await switchingInput()
  const pinMap = input.definition.pinMap
  const converted = convert({ next: input })
  const long = run({ input, bits: "10", interval: "5ns", duration: "10ns" })
  const solve = createNativeSolver({
    tools: { ngspice: process.env.NGSPICE_BIN || "ngspice" },
  })
  const traces: SpiceSamples[] = []
  for (const [model, duration] of [
    [converted, "5n"],
    [convert({ next: long }), "10n"],
  ] as const) {
    const nodes = Object.values(model.spicePinMapping).map((port) => {
      if (port === pinMap["1"]) return "out"
      if (port === pinMap["2"]) return "vdd"
      return "0"
    })
    const name = subcircuitHeader(model.source)![1]
    const deck = [
      "Buffer-only settled tail oracle",
      model.source,
      `XU ${nodes.join(" ")} ${name}`,
      "VSUPPLY vdd 0 1.5",
      "Rload out 0 50",
      ".control",
      "set wr_singlescale",
      "set wr_vecnames",
      `tran 2p ${duration}`,
      "wrdata waveform.dat v(out)",
      "quit",
      ".endc",
      ".end",
      "",
    ].join("\n")
    const output = await solve({
      solver: "ngspice",
      files: { "buffer.cir": deck },
      args: ["-n", "-b", "buffer.cir"],
      outputFiles: ["waveform.dat"],
    })
    assert.doesNotMatch(
      `${output.stdout}${output.stderr}`,
      /error|fatal|aborted|singular|timestep too small/i,
    )
    const rows = output.files["waveform.dat"].trim().split("\n").slice(1)
    traces.push(
      rows.map(
        (line) => splitWords(line.trim()).map(Number) as SpiceSamples[number],
      ),
    )
  }
  for (const time of [0.1e-9, 0.3e-9, 0.5e-9, 0.7e-9, 1e-9]) {
    assert.ok(
      Math.abs(interpolate(traces[0], time) - interpolate(traces[1], time)) <
        0.002,
    )
    const shortBit = interpolate(traces[0], 1.25e-9 + time)
    const fullAcquisition = interpolate(traces[1], 5e-9 + time)
    const difference = Math.abs(shortBit - fullAcquisition)
    assert.ok(
      difference < 0.002,
      "short-bit and full-waveform falling responses agree within 2 mV",
    )
  }
})
