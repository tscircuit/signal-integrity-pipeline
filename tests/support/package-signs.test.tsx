import { afterEach, mock, spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit } from "@tscircuit/core"
import React from "react"
import { convertPackaged } from "../../src/buffers/package"
import { sha256 } from "../../src/kernel"
import { Board, source } from "../fixtures/coupled-package"

afterEach(() => mock.restore())

test("TSX positive vendor capacitance magnitudes require a visible, hashed Maxwell correction", async () => {
  const positive = source
    .replaceAll("-.2p", ".2p")
    .replaceAll("-.5p", ".5p")
    .replaceAll("-.1p", ".1p")
  const bytes = new TextEncoder().encode(positive)
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const model = circuit
    .getCircuitJson()
    .find((record) => record.type === "simulation_ibis_model")!
  const pinMap = model.ibis_pin_name_to_source_port_id
  const input = {
    definition: {
      source: { file: "fixture.ibs" },
      component: "fixture",
      pinMap,
      corner: "typical" as const,
      packagePolicy: "vendor" as const,
    },
    run: {
      duration: "1ns",
      pinStates: {
        [pinMap.A1]: { mode: "input" as const },
        [pinMap.B1]: { mode: "input" as const },
      },
      stimuli: {},
    },
  }
  const log = spyOn(console, "warn").mockImplementation(
    (..._args: unknown[]): void => {},
  )
  const converted = convertPackaged({ bytes, input })
  const warning = converted.warnings.find((message) =>
    message.includes("negated 6 off-diagonal capacitance entries"),
  )
  assert.ok(warning, "both symmetric entries of each nonzero pair are counted")
  assert.ok(
    warning.includes("fixture.ibs") &&
      warning.includes(sha256(bytes)) &&
      warning.includes("coupled"),
  )
  assert.ok(log.mock.calls.some((args) => args.includes(warning)))
  assert.equal(
    converted.sourceSha256,
    sha256(bytes),
    "evidence hashes the unchanged vendor bytes",
  )
  assert.match(converted.source, /CPKG0_1a PAD0 PAD1 2\.5e-13/)
  const mixedSigns = source.replace("-.2p", ".2p")
  const nonDominant = source
    .replace("3p -.2p -.5p", ".1p .2p .5p")
    .replaceAll("-.1p", ".1p")
  for (const invalid of [mixedSigns, nonDominant]) {
    const bytes = new TextEncoder().encode(invalid)
    assert.throws(
      () => convertPackaged({ bytes, input }),
      /Maxwell capacitance|positive definite/,
    )
  }
  const unchanged = convertPackaged({
    bytes: new TextEncoder().encode(source),
    input,
  })
  assert.deepEqual(
    converted.metadata.packageData.matrices?.C,
    unchanged.metadata.packageData.matrices?.C,
  )
  assert.ok(!unchanged.warnings.some((message) => message.includes("negated")))
})
