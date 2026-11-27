import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, calculateRlgc } from "../../../src/rlgc"
import {
  centred,
  copper,
  mu0,
  recededInductance,
  surface,
  WHEELER_TOLERANCE,
} from "../../fixtures/rlgc-golden"

test("golden stage 3: skin resistance equals Wheeler's rule recomputed independently", () => {
  // (b) Wheeler's rule recomputed here: own recession (planes move away, strips shrink), own step 5e-4 mm vs the
  // solver's ~1.75e-4 mm, from the solver's vacuum L = mu0 eps0 C0^-1. Within 1%: both are central differences of
  // the same smooth L(n), so a larger gap would be a units, constant or wall-direction error.
  const pair: CrossSection = {
    conductors: [-0.375, 0.375].map((x, i) => ({
      conductorId: `m${i}`,
      xMm: x,
      zMm: 0.5,
      widthMm: 0.5,
      thicknessMm: 0.035,
    })),
    planes: [{ zMm: 0 }],
    dielectricLayers: [
      {
        zMm: 0,
        thicknessMm: 0.5,
        relativePermittivity: 4,
        lossTangent: 0,
      },
    ],
  }
  const failures: string[] = []
  const stripline = centred({ w: 1, b: 1, t: 0.035 })
  for (const [label, section] of [
    ["stripline w/b 1", stripline],
    ["microstrip pair", pair],
  ] as const) {
    const step = 5e-4
    const plus = recededInductance({ section, offsetMm: step })
    const minus = recededInductance({ section, offsetMm: -step })
    const solved = calculateRlgc({
      crossSection: section,
    }).totalSkinResistanceOhmsPerMeterPerSqrtHz
    const deviations = solved.flatMap((row, i) =>
      row.map((value, j) => {
        const derivative =
          ((surface(copper) / mu0) * (plus[i][j] - minus[i][j])) /
          (2 * step * 1e-3)
        return Math.abs(derivative / value - 1)
      }),
    )
    const worst = Math.max(...deviations)
    console.log(
      `${label}: worst |R_wheeler / R_solver - 1| = ${worst.toExponential(3)}`,
    )
    if (!(worst <= WHEELER_TOLERANCE)) failures.push(`${label}: ${worst}`)
  }
  assert.deepEqual(failures, [])
}, 30_000)
