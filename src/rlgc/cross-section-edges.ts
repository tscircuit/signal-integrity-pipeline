import { hypotenuse } from "../kernel"
import type {
  BoundaryPanel,
  CrossSectionConductor,
  CrossSectionDielectricLayer,
  RegionMeshInput,
} from "./cross-section-types"

/** Grade panels toward the ends of each edge with a quartic distribution. */
const PANEL_GRADING_POWER = 4

/** Start increasing panel count at six plane distances of horizontal conductor face. */
const FACE_LENGTH_IN_PLANE_DISTANCES = 6

/** Relative permittivity and loss tangent of the material at a boundary. */
type BoundaryMaterial = Pick<
  CrossSectionDielectricLayer,
  "relativePermittivity" | "lossTangent"
>

/** Material adjacent to a boundary; non-overlapping dielectric layers leave air elsewhere. */
export function getMaterial({
  dielectricLayers,
  zMm,
}: {
  dielectricLayers: CrossSectionDielectricLayer[]
  zMm: number
}): BoundaryMaterial {
  return (
    dielectricLayers.find(
      (layer) => zMm > layer.zMm && zMm < layer.zMm + layer.thicknessMm,
    ) ?? { relativePermittivity: 1, lossTangent: 0 }
  )
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
export function mergeCoordinates({
  coordinatesMm,
  coordinateToleranceMm,
}: {
  coordinatesMm: number[]
  coordinateToleranceMm: number
}): number[] {
  return [...coordinatesMm]
    .sort((a, b) => a - b)
    .filter(
      (coordinateMm, i, sorted) =>
        !i || coordinateMm - sorted[i - 1] > coordinateToleranceMm,
    )
}

/** Segment geometry and material for a conductor or dielectric edge. */
export interface BoundaryEdge {
  startXMm: number
  startZMm: number
  endXMm: number
  endZMm: number
  conductorIndex: number
  relativePermittivity: number
  lossTangent: number
  permittivityContrast?: number
  contrastLossDerivative?: number
  steps: number
}

/** Number of graded panels on a horizontal edge at the requested resolution. */
export function calculateHorizontalPanelCount({
  panelsPerEdge,
  lengthMm,
  clearanceMm,
}: {
  panelsPerEdge: number
  lengthMm: number
  clearanceMm: number
}): number {
  return Math.max(
    panelsPerEdge,
    Math.ceil(
      (panelsPerEdge * lengthMm) /
        (FACE_LENGTH_IN_PLANE_DISTANCES * clearanceMm),
    ),
  )
}

/** Horizontal face counts in conductor order, reusable across vacuum wall displacements. */
export function calculateConductorFaceCounts({
  region,
  panelsPerEdge,
}: RegionMeshInput): number[] {
  return region.conductors.map((conductor) => {
    let clearanceMm = conductor.zMm
    if (region.planeSpacingMm) {
      clearanceMm = Math.min(
        clearanceMm,
        region.planeSpacingMm - conductor.zMm - conductor.thicknessMm,
      )
    }
    return calculateHorizontalPanelCount({
      panelsPerEdge,
      lengthMm: conductor.widthMm,
      clearanceMm,
    })
  })
}

/** Quartic grading resolves the integrable corner charge singularity. */
function calculatePanelFraction({
  i,
  steps,
}: {
  i: number
  steps: number
}): number {
  const start = i ** PANEL_GRADING_POWER
  const end = (steps - i) ** PANEL_GRADING_POWER
  return start / (start + end)
}

/** Build panels along a straight edge with its outward metal normal. */
export function buildEdgePanels({
  startXMm,
  startZMm,
  endXMm,
  endZMm,
  conductorIndex,
  relativePermittivity,
  lossTangent,
  permittivityContrast = 0,
  contrastLossDerivative = 0,
  steps,
}: BoundaryEdge): BoundaryPanel[] {
  const result: BoundaryPanel[] = []
  const dxMm = endXMm - startXMm
  const dzMm = endZMm - startZMm
  const lengthMm = hypotenuse(dxMm, dzMm)
  for (let i = 0; i < steps; i++) {
    const startFraction = calculatePanelFraction({ i, steps })
    const endFraction = calculatePanelFraction({ i: i + 1, steps })
    result.push({
      centerXMm: startXMm + (dxMm * (startFraction + endFraction)) / 2,
      centerZMm: startZMm + (dzMm * (startFraction + endFraction)) / 2,
      tangentX: dxMm / lengthMm,
      tangentZ: dzMm / lengthMm,
      lengthMm: lengthMm * (endFraction - startFraction),
      conductorIndex,
      relativePermittivity,
      lossTangent,
      permittivityContrast,
      contrastLossDerivative,
    })
  }
  return result
}

/** Plan one conductor's faces, splitting the sides wherever dielectric material changes. */
export function planConductorEdges({
  verticalSteps,
  facePanelCount,
  conductor,
  conductorIndex,
  dielectricLayers,
  materialProbeMm,
  coordinateToleranceMm,
}: {
  verticalSteps: number
  facePanelCount: number
  conductor: CrossSectionConductor
  conductorIndex: number
  dielectricLayers: CrossSectionDielectricLayer[]
  materialProbeMm: number
  coordinateToleranceMm: number
}): BoundaryEdge[] {
  const bottomZMm = conductor.zMm
  const topZMm = bottomZMm + conductor.thicknessMm
  const leftXMm = conductor.xMm - conductor.widthMm / 2
  const rightXMm = conductor.xMm + conductor.widthMm / 2
  const bottomMaterial = getMaterial({
    dielectricLayers,
    zMm: bottomZMm - materialProbeMm,
  })
  const topMaterial = getMaterial({
    dielectricLayers,
    zMm: topZMm + materialProbeMm,
  })
  const edges: BoundaryEdge[] = [
    {
      startXMm: leftXMm,
      startZMm: bottomZMm,
      endXMm: rightXMm,
      endZMm: bottomZMm,
      conductorIndex,
      ...bottomMaterial,
      steps: facePanelCount,
    },
    {
      startXMm: rightXMm,
      startZMm: topZMm,
      endXMm: leftXMm,
      endZMm: topZMm,
      conductorIndex,
      ...topMaterial,
      steps: facePanelCount,
    },
  ]
  const boundaries = dielectricLayers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const interior = boundaries.filter(
    (zMm) =>
      zMm > bottomZMm + coordinateToleranceMm &&
      zMm < topZMm - coordinateToleranceMm,
  )
  const sidewallBoundaryHeightsMm = mergeCoordinates({
    coordinatesMm: [bottomZMm, topZMm, ...interior],
    coordinateToleranceMm,
  })
  for (let k = 1; k < sidewallBoundaryHeightsMm.length; k++) {
    const adjacent = getMaterial({
      dielectricLayers,
      zMm:
        (sidewallBoundaryHeightsMm[k - 1] + sidewallBoundaryHeightsMm[k]) / 2,
    })
    edges.push({
      startXMm: rightXMm,
      startZMm: sidewallBoundaryHeightsMm[k - 1],
      endXMm: rightXMm,
      endZMm: sidewallBoundaryHeightsMm[k],
      conductorIndex,
      ...adjacent,
      steps: verticalSteps,
    })
    edges.push({
      startXMm: leftXMm,
      startZMm: sidewallBoundaryHeightsMm[k],
      endXMm: leftXMm,
      endZMm: sidewallBoundaryHeightsMm[k - 1],
      conductorIndex,
      ...adjacent,
      steps: verticalSteps,
    })
  }
  return edges
}
