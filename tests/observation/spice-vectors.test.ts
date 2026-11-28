import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  formatSpiceVectors,
  parseSpiceVectors,
  spiceProbeRows,
} from "../../src/observation"

const vectors = [
  { name: "v(n2)", type: "voltage", values: [1, 2, 3] },
  { name: "time", type: "time", values: [0, 1e-9, 2e-9] },
  { name: "v(n1)", type: "voltage", values: [3, 5, 7] },
]

const raw = formatSpiceVectors(vectors)

test("preserves the order and precision of raw vectors", () => {
  assert.deepEqual(parseSpiceVectors(raw), vectors)
})

test("subtracts the reference at each sampled time", () => {
  const probes = [
    { signalNode: "N1", referenceNode: "n2" },
    { signalNode: "n2", referenceNode: "0" },
  ]
  assert.deepEqual(spiceProbeRows({ text: raw, probes }), [
    [0, 2, 1],
    [1e-9, 3, 2],
    [2e-9, 4, 3],
  ])
})

for (const [description, text] of [
  ["a missing header", ""],
  ["complex flags", raw.replace("Flags: real", "Flags: complex")],
  ["a truncated capture", raw.replace("No. Points: 3", "No. Points: 4")],
  ["duplicate names", raw.replace("v(n1)", "v(n2)")],
  ["a nonfinite value", raw.replace("0\t1", "0\tNaN")],
  ["a mismatched sample index", raw.replace("0\t1", "7\t1")],
  ["a mismatched variable index", raw.replace("2\tv(n1)", "7\tv(n1)")],
]) {
  test(`rejects ${description}`, () => {
    assert.throws(() => parseSpiceVectors(text), { code: "waveform" })
  })
}

test("requires every requested voltage vector", () => {
  const probes = [{ signalNode: "absent", referenceNode: "0" }]
  assert.throws(
    () => spiceProbeRows({ text: raw, probes }),
    /Missing ngspice vector/,
  )
})

test("requires a time vector", () => {
  const text = raw.replace("time\ttime", "clock\ttime")
  assert.throws(
    () => spiceProbeRows({ text, probes: [] }),
    /Missing ngspice time/,
  )
})

test("refuses to format invalid vectors", () => {
  assert.throws(
    () => formatSpiceVectors([{ ...vectors[0], values: [NaN, 0] }]),
    /finite/,
  )
})

test("keeps the last sample at duplicate breakpoints", () => {
  const text = formatSpiceVectors([
    { name: "time", type: "time", values: [0, 1, 1, 2] },
    { name: "v(n)", type: "voltage", values: [0, 1, 2, 3] },
  ])
  const probes = [{ signalNode: "n", referenceNode: "0" }]
  assert.deepEqual(spiceProbeRows({ text, probes }), [
    [0, 0],
    [1, 2],
    [2, 3],
  ])
})

test("rejects decreasing timestamps", () => {
  const decreasing = formatSpiceVectors([
    { name: "time", type: "time", values: [1, 0] },
    { name: "v(n)", type: "voltage", values: [0, 0] },
  ])
  assert.throws(
    () => spiceProbeRows({ text: decreasing, probes: [] }),
    /increasing/,
  )
})
