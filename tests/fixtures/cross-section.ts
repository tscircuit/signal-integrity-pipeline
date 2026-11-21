import type { CrossSection } from "../../src/extraction"

const DEFAULT_CONDUCTOR_COUNT = 1

/** Thin rectangular lines approach the zero-thickness published oracles without altering them. */
export function sectionFixture({
  kind,
  count = DEFAULT_CONDUCTOR_COUNT,
}: {
  kind: "microstrip" | "stripline" | "mask"
  count?: number
}): CrossSection {
  let thicknessMm = 0.001
  if (kind === "mask") thicknessMm = 0.035
  const conductors = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    xMm: (i - (count - 1) / 2) * 1.5,
    zMm: 1,
    widthMm: 1,
    thicknessMm,
  }))
  const planes: CrossSection["planes"] = [{ zMm: 0 }]
  if (kind === "stripline") planes.push({ zMm: 2.001 })
  const dielectrics: CrossSection["dielectrics"] = [
    {
      zMm: 0,
      thicknessMm: planes[1]?.zMm ?? 1,
      er: 4,
      lossTangent: 0.02,
    },
  ]
  if (kind === "mask") {
    dielectrics.push({
      zMm: 1,
      thicknessMm: 0.055,
      er: 3.3,
      lossTangent: 0.025,
    })
  }
  return { conductors, planes, dielectrics }
}
