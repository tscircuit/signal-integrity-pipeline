import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisComponentWithPackage } from "../../src/buffers/package-conversion"
import { sha256 } from "../../src/kernel"
import { source } from "../fixtures/coupled-package"

import { packageInput, renderPackageModel } from "../fixtures/package-input"

test("TSX positive vendor capacitance magnitudes require a visible, hashed capacitance sign conversion", async () => {
  const positive = source
    .replaceAll("-.2p", ".2p")
    .replaceAll("-.5p", ".5p")
    .replaceAll("-.1p", ".1p")
  const bytes = new TextEncoder().encode(positive)
  const input = packageInput(await renderPackageModel())
  const converted = convertIbisComponentWithPackage({ bytes, input })
  const warning = converted.warnings.find((message) =>
    message.includes("negated 6 off-diagonal capacitance entries"),
  )
  assert.ok(warning, "both symmetric entries of each nonzero pair are counted")
  assert.ok(
    warning.includes("fixture.ibs") &&
      warning.includes(sha256(bytes)) &&
      warning.includes("coupled"),
  )
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
      () => convertIbisComponentWithPackage({ bytes, input }),
      /Maxwell capacitance|positive definite/,
    )
  }
  const unchanged = convertIbisComponentWithPackage({
    bytes: new TextEncoder().encode(source),
    input,
  })
  assert.deepEqual(
    converted.metadata.packageData.matrices?.C,
    unchanged.metadata.packageData.matrices?.C,
  )
  assert.ok(!unchanged.warnings.some((message) => message.includes("negated")))
})
