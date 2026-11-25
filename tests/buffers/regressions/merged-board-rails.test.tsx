import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertPackaged } from "../../../src/buffers/package"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test("uses one lossless package branch for rail pins merged on the board", async () => {
  const base = packageInput(await renderPackageModel(true))
  const { pinMap } = base.definition
  const input = {
    ...base,
    definition: {
      ...base.definition,
      references: {
        A1: { pullup: pinMap.V1, powerClamp: pinMap.V1 },
        B1: { pullup: pinMap.V2, powerClamp: pinMap.V2 },
      },
    },
  }
  const ibis = source
    .replace(
      "[Model] input",
      `V2 VDD2 POWER
[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref
A1 GND PWR GND PWR
B1 GND PWR GND PWR
G1 GND NC GND NC
V1 NC PWR NC NC
V2 NC PWR NC NC
[Model] input`,
    )
    .replace(
      source.slice(
        source.indexOf("[Resistance Matrix]"),
        source.indexOf("[Inductance Matrix]"),
      ),
      "",
    )
  const converted = convertPackaged({
    bytes: new TextEncoder().encode(ibis),
    input,
  })
  assert.deepEqual(converted.metadata.packageData.matrices?.mergedPins, {
    V2: "V1",
  })
  assert.doesNotMatch(converted.source, /^V(?:DIE|PKGM)/m)
  assert.match(converted.source, /^XBUF0 PKGD0 PKGD2 PKGD3 PKGD2 PKGD3 /m)
  assert.match(converted.source, /^XBUF1 PKGD1 PKGD2 PKGD3 PKGD2 PKGD3 /m)
})
