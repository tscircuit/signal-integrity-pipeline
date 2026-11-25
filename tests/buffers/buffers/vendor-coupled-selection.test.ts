import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import {
  buildCoupledPackageSpiceElements,
  parseIbis,
  resolveCoupledPackage,
} from "@tscircuit/ibis-to-spice"
import { addrCmdPins } from "../../../examples/routed/ddr3-signals"
import {
  loadVendorModelText,
  vendorAvailable,
  vendorModels,
} from "../../fixtures/vendor-models"
import {
  energyFacts,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../../support/golden-checks"

setDefaultTimeout(150_000)

const coupledSelection = `golden invariants: DDR3 coupled-package selections stay SPD with |k| < 1, Maxwell ${"C and realizable K"}`
test.skipIf(!vendorAvailable("sprm552c.ibs"))(coupledSelection, async () => {
  // Same physics as the full-matrix check (tests/buffers/package-matrix.test.ts), on the exact pin sets the DDR3
  // TSX declarations select (examples/routed/ddr3-signals.tsx). Schur reduction of floating unused pins preserves
  // definiteness (Horn & Johnson, Matrix Analysis, 2nd ed., Theorem 7.7.6), and ngspice K must satisfy |k| < 1.
  const text = await loadVendorModelText(vendorModels.am335x)
  const document = parseIbis(text)
  const component = document.components.am335x_zcz
  const sets = {
    addrCmd: addrCmdPins.map(([, pin]) => pin),
    dqWrite: ["M3", "M4", "N1", "N2", "N3", "N4", "P3", "P4", "M2", "P1", "P2"],
  }
  const failures: string[] = []
  for (const [name, signals] of Object.entries(sets)) {
    const selected = resolveCoupledPackage({
      document,
      component,
      pins: [...signals, "E5", "A1"],
    })
    assert.ok(selected)
    const L = energyFacts(selected.L)
    const C = energyFacts(selected.C)
    const maxwell = maxwellFacts(selected.C)
    const elements = buildCoupledPackageSpiceElements({
      matrices: selected,
      terminals: selected.activePins.map((_, i) => `B${i}`),
      die: selected.activePins.map((_, i) => `D${i}`),
      ground: "G",
    })
    const couplings = elements.filter((line) => line.startsWith("K"))
    const k = Math.max(
      ...couplings.map((line) => Math.abs(Number(line.split(" ")[3]))),
    )
    console.log(
      JSON.stringify({
        set: name,
        pins: selected.activePins.length,
        mergedPins: selected.mergedPins,
        L,
        C,
        maxwell,
        largestKElement: k,
        largestKPins: L.pair.map((i) => selected.activePins[i]),
      }),
    )
    if (!isPositiveDefinite(L)) failures.push(`${name} L: ${JSON.stringify(L)}`)
    if (!isPositiveDefinite(C)) failures.push(`${name} C: ${JSON.stringify(C)}`)
    if (!isGroundedMaxwell({ facts: maxwell }))
      failures.push(`${name} Maxwell: ${JSON.stringify(maxwell)}`)
    if (!(k < 1)) failures.push(`${name}: K element ${k}`)
  }
  assert.deepEqual(failures, [])
})
