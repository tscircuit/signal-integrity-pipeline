import assert from "node:assert/strict"
import type { Matrix } from "../../src/kernel"
import type { CrossSection } from "../../src/rlgc"

const DEFAULT_CONDUCTOR_COUNT = 1

/** Thin rectangular lines approach the zero-thickness published oracles without altering them. */
export function crossSectionFixture({
  kind,
  count = DEFAULT_CONDUCTOR_COUNT,
}: {
  kind: "microstrip" | "stripline" | "mask"
  count?: number
}): CrossSection {
  let thicknessMm = 0.001
  if (kind === "mask") thicknessMm = 0.035
  const conductors = Array.from({ length: count }, (_, i) => ({
    conductorId: `s${i}`,
    xMm: (i - (count - 1) / 2) * 1.5,
    zMm: 1,
    widthMm: 1,
    thicknessMm,
  }))
  const planes: CrossSection["planes"] = [{ zMm: 0 }]
  if (kind === "stripline") planes.push({ zMm: 2.001 })
  const dielectricLayers: CrossSection["dielectricLayers"] = [
    {
      zMm: 0,
      thicknessMm: planes[1]?.zMm ?? 1,
      relativePermittivity: 4,
      lossTangent: 0.02,
    },
  ]
  if (kind === "mask") {
    dielectricLayers.push({
      zMm: 1,
      thicknessMm: 0.055,
      relativePermittivity: 3.3,
      lossTangent: 0.025,
    })
  }
  return { conductors, planes, dielectricLayers }
}

/** Speed of light in vacuum in meters per second, exact in SI. */
export const LIGHT_SPEED = 299792458

/** Normalized microstrip family; includes very thin, nearly coincident top/bottom panels. */
export function microstripFixture({
  width,
  gap,
  er,
  count,
  thickness,
}: {
  width: number
  gap: number
  er: number
  count: number
  thickness: number
}): CrossSection {
  return {
    conductors: Array.from({ length: count }, (_, i) => ({
      conductorId: String(i),
      xMm: (i - (count - 1) / 2) * (width + gap),
      zMm: 1,
      widthMm: width,
      thicknessMm: thickness,
    })),
    planes: [{ zMm: 0 }],
    dielectricLayers: [
      {
        zMm: 0,
        thicknessMm: 1,
        relativePermittivity: er,
        lossTangent: 0,
      },
    ],
  }
}

/** Independent Cholesky test of strict positive definiteness, scaled to matrix magnitude. */
export function assertPositiveDefinite(matrix: Matrix): void {
  const a = matrix.map((row) => [...row])
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j <= i; j++) {
      let coefficient = a[i][j]
      for (let k = 0; k < j; k++) coefficient -= a[i][k] * a[j][k]
      if (i === j) {
        assert.ok(coefficient > 0, `positive pivot ${i}: ${coefficient}`)
        a[i][j] = Math.sqrt(coefficient)
        continue
      }
      a[i][j] = coefficient / a[j][j]
    }
  }
}
