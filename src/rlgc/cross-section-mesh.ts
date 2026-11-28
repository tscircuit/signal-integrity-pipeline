import {
  type BoundaryEdge,
  buildEdgePanels,
  calculateConductorFaceCounts,
  calculateHorizontalPanelCount,
  getMaterial,
  mergeCoordinates,
  planConductorEdges,
} from "./cross-section-edges"
import { DIELECTRIC_BOUNDARY_TOLERANCE_MM } from "./cross-section-regions"
import type {
  BoundaryPanel,
  CrossSectionDielectricLayer,
  RegionMeshInput,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Sample just inside each material relative to the smallest feature in the cross-section. */
const MATERIAL_PROBE_FRACTION = 1e-7

/** Merge mesh coordinates at a tighter tolerance than the material probe offset. */
const COORDINATE_TOLERANCE_DIVISOR = 100

/** Bound each dense field matrix to fewer than ten million coefficients. */
const MAX_REGION_PANELS = 3072

/** Mesh a short vertical face at roughly one third of the horizontal panel count. */
const VERTICAL_PANEL_DIVISOR = 3

/** Keep at least four panels on a vertical edge to resolve its corners. */
const MIN_VERTICAL_PANELS = 4

/** A negative conductor index marks a dielectric interface row instead of a conductor excitation. */
const DIELECTRIC_INTERFACE = -1

/** Collapse interfaces that have no real permittivity contrast for capacitance-only calculations. */
function mergeRealDielectricLayers(
  dielectricLayers: CrossSectionDielectricLayer[],
): CrossSectionDielectricLayer[] {
  const mergedLayers: CrossSectionDielectricLayer[] = []
  for (const layer of [...dielectricLayers].sort((a, b) => a.zMm - b.zMm)) {
    if (layer.relativePermittivity === 1) continue
    const previous = mergedLayers.at(-1)
    if (
      previous &&
      previous.relativePermittivity === layer.relativePermittivity &&
      Math.abs(layer.zMm - (previous.zMm + previous.thicknessMm)) <=
        DIELECTRIC_BOUNDARY_TOLERANCE_MM
    ) {
      mergedLayers[mergedLayers.length - 1] = {
        ...previous,
        thicknessMm: layer.zMm + layer.thicknessMm - previous.zMm,
      }
      continue
    }
    mergedLayers.push(layer)
  }
  return mergedLayers
}

/** Plan region edges before allocating any panels. */
function* planRegionEdges(mesh: RegionMeshInput): Iterable<BoundaryEdge> {
  const { region, panelsPerEdge, interfaceExtent, isVacuum } = mesh
  let dielectricLayers = region.dielectricLayers
  if (isVacuum) dielectricLayers = []
  if (mesh.includeDielectricLoss === false)
    dielectricLayers = mergeRealDielectricLayers(dielectricLayers)
  const conductorSpansMm = region.conductors.map((c) =>
    Math.max(c.widthMm, c.zMm + c.thicknessMm),
  )
  const dielectricTopsMm = dielectricLayers.map(
    (layer) => layer.zMm + layer.thicknessMm,
  )
  const scaleMm = Math.max(...conductorSpansMm, ...dielectricTopsMm)
  const conductorSizesMm = region.conductors.flatMap((c) => [
    c.widthMm,
    c.thicknessMm,
  ])
  const dielectricThicknessesMm = dielectricLayers.map(
    (layer) => layer.thicknessMm,
  )
  const materialProbeMm =
    Math.min(...conductorSizesMm, ...dielectricThicknessesMm) *
    MATERIAL_PROBE_FRACTION
  const coordinateToleranceMm = materialProbeMm / COORDINATE_TOLERANCE_DIVISOR
  const verticalSteps = Math.max(
    MIN_VERTICAL_PANELS,
    Math.ceil(panelsPerEdge / VERTICAL_PANEL_DIVISOR),
  )
  const facePanelCounts =
    mesh.facePanelCounts ?? calculateConductorFaceCounts(mesh)
  for (const [conductorIndex, conductor] of region.conductors.entries()) {
    yield* planConductorEdges({
      verticalSteps,
      facePanelCount: facePanelCounts[conductorIndex],
      conductor,
      conductorIndex,
      dielectricLayers,
      materialProbeMm,
      coordinateToleranceMm,
    })
  }
  if (!dielectricLayers.length) return

  const conductorProjectionsMm = region.conductors.flatMap((c) => [
    c.xMm - c.widthMm / 2,
    c.xMm + c.widthMm / 2,
  ])
  // Between two grounded planes the first transverse mode decays by e per spacing / pi.
  let paddingMm = interfaceExtent * scaleMm
  if (region.planeSpacingMm)
    paddingMm = interfaceExtent * (region.planeSpacingMm / Math.PI)
  if (!Number.isFinite(paddingMm))
    fail({
      code: "mesh_panel_limit",
      text: "Nonfinite interface extent exceeds the mesh panel limit",
    })
  const startXMm = Math.min(...conductorProjectionsMm) - paddingMm
  const endXMm = Math.max(...conductorProjectionsMm) + paddingMm
  const edgeCoordinatesMm = mergeCoordinates({
    coordinatesMm: [startXMm, ...conductorProjectionsMm, endXMm],
    coordinateToleranceMm,
  })
  const dielectricBoundaryHeightsMm = dielectricLayers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const boundaryHeightsMm = mergeCoordinates({
    coordinatesMm: dielectricBoundaryHeightsMm,
    coordinateToleranceMm: Math.min(
      coordinateToleranceMm,
      DIELECTRIC_BOUNDARY_TOLERANCE_MM,
    ),
  })
  for (const [index, zMm] of boundaryHeightsMm.entries()) {
    if (zMm <= coordinateToleranceMm) continue
    if (
      region.planeSpacingMm &&
      zMm >= region.planeSpacingMm - coordinateToleranceMm
    )
      continue

    // Stay in the neighboring height interval even when an air gap is thinner than the probe.
    let lowerProbeMm = materialProbeMm
    let upperProbeMm = materialProbeMm
    if (index > 0)
      lowerProbeMm = Math.min(
        lowerProbeMm,
        (zMm - boundaryHeightsMm[index - 1]) / 2,
      )
    if (index + 1 < boundaryHeightsMm.length)
      upperProbeMm = Math.min(
        upperProbeMm,
        (boundaryHeightsMm[index + 1] - zMm) / 2,
      )
    const below = getMaterial({ dielectricLayers, zMm: zMm - lowerProbeMm })
    const above = getMaterial({ dielectricLayers, zMm: zMm + upperProbeMm })
    if (
      below.relativePermittivity === above.relativePermittivity &&
      below.lossTangent === above.lossTangent
    )
      continue
    const permittivitySum =
      below.relativePermittivity + above.relativePermittivity
    const permittivityContrast =
      (2 * (below.relativePermittivity - above.relativePermittivity)) /
      permittivitySum
    const contrastLossDerivative =
      (4 *
        below.relativePermittivity *
        above.relativePermittivity *
        (below.lossTangent - above.lossTangent)) /
      permittivitySum ** 2
    for (let k = 1; k < edgeCoordinatesMm.length; k++) {
      const middleXMm = (edgeCoordinatesMm[k - 1] + edgeCoordinatesMm[k]) / 2
      const isCovered = region.conductors.some((c) => {
        const isWithinWidth =
          middleXMm > c.xMm - c.widthMm / 2 && middleXMm < c.xMm + c.widthMm / 2
        return (
          isWithinWidth &&
          zMm >= c.zMm - materialProbeMm &&
          zMm <= c.zMm + c.thicknessMm + materialProbeMm
        )
      })
      if (isCovered) continue
      let steps = panelsPerEdge
      if (region.planeSpacingMm) {
        steps = calculateHorizontalPanelCount({
          panelsPerEdge,
          lengthMm: edgeCoordinatesMm[k] - edgeCoordinatesMm[k - 1],
          clearanceMm: Math.min(zMm, region.planeSpacingMm - zMm),
        })
      }
      yield {
        startXMm: edgeCoordinatesMm[k - 1],
        startZMm: zMm,
        endXMm: edgeCoordinatesMm[k],
        endZMm: zMm,
        conductorIndex: DIELECTRIC_INTERFACE,
        relativePermittivity: 1,
        lossTangent: 0,
        permittivityContrast,
        contrastLossDerivative,
        steps,
      }
    }
  }
}

/** Build quartically graded panels, or reject an oversized region before panel allocation. */
export function buildRegionPanels(mesh: RegionMeshInput): BoundaryPanel[] {
  const edges: BoundaryEdge[] = []
  let panelCount = 0
  for (const edge of planRegionEdges(mesh)) {
    panelCount += edge.steps
    if (!Number.isSafeInteger(panelCount) || panelCount > MAX_REGION_PANELS) {
      fail({
        code: "mesh_panel_limit",
        text: `Cross-section region exceeds the panel limit of ${MAX_REGION_PANELS} (at least ${panelCount} requested). Reduce the resolution or interface extent.`,
      })
    }
    edges.push(edge)
  }
  return edges.flatMap(buildEdgePanels)
}
