import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, calculateRlgc } from "../../../src/rlgc"
import { copper, DC_RESISTANCE_TOLERANCE } from "../../fixtures/rlgc-golden"

test("golden stage 3: DC resistance R = rho l / A", () => {
  // R per metre = 1/(sigma w t) exactly, 1e-12 relative; infinite planes carry no DC resistance in this model. The
  // deck's own DC path is check 25 (ngspice .op divider).
  const section: CrossSection = {
    conductors: [
      {
        conductorId: "cu",
        xMm: -0.3,
        zMm: 0.4825,
        widthMm: 0.2,
        thicknessMm: 0.035,
      },
      {
        conductorId: "alloy",
        xMm: 0.3,
        zMm: 0.491,
        widthMm: 0.15,
        thicknessMm: 0.018,
        conductivitySm: 3.5e7,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: 1 }],
    dielectricLayers: [
      {
        zMm: 0,
        thicknessMm: 1,
        relativePermittivity: 4,
        lossTangent: 0.01,
      },
    ],
  }
  const line = calculateRlgc({ crossSection: section })
  const expected = section.conductors.map((c) => {
    const conductivity = c.conductivitySm ?? copper
    return 1 / (conductivity * c.widthMm * 1e-3 * c.thicknessMm * 1e-3)
  })
  const failures: string[] = []
  for (const [i, value] of expected.entries()) {
    const resistance = line.dcResistanceOhmsPerMeter[i][i]
    if (!(Math.abs(resistance / value - 1) <= DC_RESISTANCE_TOLERANCE)) {
      failures.push(`R_dc ${i}: ${resistance} vs ${value}`)
    }
  }
  if (
    line.dcResistanceOhmsPerMeter[0][1] !== 0 ||
    line.dcResistanceOhmsPerMeter[1][0] !== 0
  ) {
    failures.push("ideal planes must not couple DC resistance")
  }
  assert.deepEqual(failures, [])
}, 30_000)
