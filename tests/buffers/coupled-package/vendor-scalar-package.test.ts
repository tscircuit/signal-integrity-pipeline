import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import { parseIbis } from "@tscircuit/ibis-to-spice"
import { resolveCoupledPackage } from "../../../src/buffers/coupled-package"
import {
  loadVendorModelText,
  vendorAvailable,
  vendorModels,
} from "../../fixtures/vendor-models"

setDefaultTimeout(150_000)

const scalarPackage =
  "golden invariants: Winbond DDR3 has no coupled package and every [Pin] R, L, C is non-negative"
test.skipIf(!vendorAvailable("W631GG6MB-12.ibs"))(scalarPackage, async () => {
  // A scalar lumped package is passive iff each R, L and C is non-negative (1 x 1 energy matrices).
  const text = await loadVendorModelText(vendorModels.ddr3)
  const component = parseIbis(text).components["W631GG6MB-12"]
  assert.equal(
    resolveCoupledPackage({
      text,
      component,
      pins: Object.keys(component.pins),
    }),
    undefined,
  )
  const pinValues = Object.values(component.pins).flatMap((pin) => [
    pin.resistance,
    pin.inductance,
    pin.capacitance,
  ])
  const values = pinValues.filter((value) => value !== undefined)
  console.log(
    JSON.stringify({
      pins: Object.keys(component.pins).length,
      scalarValues: values.length,
      package: component.package,
    }),
  )
  assert.ok(
    values.length > 0 &&
      values.every((value) => Number.isFinite(value) && value >= 0),
  )
})
