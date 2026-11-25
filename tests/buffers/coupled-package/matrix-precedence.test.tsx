import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisComponentWithPackage } from "../../../src/buffers/package-conversion"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test("coupled package uses the matrix terms and biases resistive die rails", async () => {
  const input = packageInput(await renderPackageModel())
  const converted = convertIbisComponentWithPackage({
    bytes: new TextEncoder().encode(source),
    input,
  })
  assert.match(converted.source, /KPKG\d+_\d+ LPKG\d+ LPKG\d+ -0\.353553/)
  assert.match(converted.source, /HPKG/)
  assert.match(converted.source, /CPKG0_1a PAD0 PAD1 2\.5e-13/)
  assert.match(converted.source, /VDIE\d+ DIE\d+ 0 1\.5/)
  assert.match(converted.source, /VDIE\d+ DIE\d+ 0 0/)
  assert.doesNotMatch(converted.source, / 99(?:\s|$)| 9e-9(?:\s|$)/)
  assert.deepEqual(converted.metadata.omissions, [])
  assert.deepEqual(converted.metadata.packageData.matrices?.activePins, [
    "A1",
    "B1",
    "V1",
    "G1",
  ])
  assert.equal(
    converted.metadata.packageData.mappedPins.find(
      (pin) => pin.physicalPin === "A1",
    )?.resistanceOhms,
    1,
  )
  const resistanceWarning = converted.warnings.find((warning) =>
    warning.startsWith("A1:"),
  )
  assert.ok(resistanceWarning)
  assert.match(resistanceWarning, /A1.*resistance.*9.*1/)
})
