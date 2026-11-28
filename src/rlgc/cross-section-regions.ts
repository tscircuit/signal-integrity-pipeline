import { defaultCopperConductivitySm } from "../board"
import type { CrossSection, FieldRegion } from "./cross-section-types"

/** Ignore sub-femtometer differences between dielectric boundaries after projection or clipping, in millimeters. */
export const DIELECTRIC_BOUNDARY_TOLERANCE_MM = 1e-12

/** A shielded region and its conductor indices in the original cross-section. */
interface IndexedFieldRegion {
  region: FieldRegion
  conductorIndices: number[]
}

/** Reflect an upper-only reference, and split conductors into regions shielded by solid planes. */
export function partitionCrossSection(
  crossSection: CrossSection,
): IndexedFieldRegion[] {
  const planes = [...crossSection.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of crossSection.conductors.entries()) {
    const key = planes.filter((plane) => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, conductorIndices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = conductorIndices.map((i) => {
      const c = crossSection.conductors[i]
      if (below) return { ...c, zMm: c.zMm - origin }
      return { ...c, zMm: origin - c.zMm - c.thicknessMm }
    })
    let planeSpacingMm = 0
    if (below && above) planeSpacingMm = above.zMm - below.zMm
    const dielectricLayers = crossSection.dielectricLayers
      .map((layer) => {
        let lowMm = Math.max(0, layer.zMm - origin)
        let highMm = Math.min(
          planeSpacingMm || Infinity,
          layer.zMm + layer.thicknessMm - origin,
        )
        if (!below) {
          lowMm = Math.max(0, origin - layer.zMm - layer.thicknessMm)
          highMm = Math.min(planeSpacingMm || Infinity, origin - layer.zMm)
        }
        return { ...layer, zMm: lowMm, thicknessMm: highMm - lowMm }
      })
      .filter((layer) => layer.thicknessMm > DIELECTRIC_BOUNDARY_TOLERANCE_MM)
    return {
      conductorIndices,
      region: {
        conductors,
        dielectricLayers,
        planeSpacingMm,
        lowerPlaneConductivitySm:
          lower.conductivitySm ?? defaultCopperConductivitySm,
        upperPlaneConductivitySm:
          above?.conductivitySm ?? defaultCopperConductivitySm,
      },
    }
  })
}
