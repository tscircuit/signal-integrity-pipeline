import { defaultCopperConductivitySm } from "../board"
import type { Matrix } from "../kernel"
import { calculateRegionField } from "./cross-section-field"
import { assertMatrixPassive, createZeroMatrix } from "./cross-section-matrix"
import { partitionCrossSection } from "./cross-section-regions"
import type {
  CrossSection,
  CrossSectionOptions,
  RlgcMatrices,
} from "./cross-section-types"
import { validateCrossSection } from "./cross-section-validation"
import {
  calculateExternalInductance,
  calculateSkinCoefficients,
} from "./cross-section-wheeler"
import { fail } from "./diagnostics"

export type {
  CrossSection,
  CrossSectionConductor,
  CrossSectionDielectricLayer,
  CrossSectionOptions,
  CrossSectionPlane,
  RlgcMatrices,
} from "./cross-section-types"

/** Default and minimum counts of panels per conductor edge. */
const DEFAULT_PANELS_PER_EDGE = 12
/** Resolve conductor corners with a minimum of six panels per edge. */
const MIN_PANELS_PER_EDGE = 6

/** Default and minimum horizontal padding measured in cross-section spans. */
const DEFAULT_INTERFACE_EXTENT = 24
/** Keep dielectric interface truncation several spans from the conductors. */
const MIN_INTERFACE_EXTENT = 4

/** Recede conductor walls by a small fraction of their clearance for Wheeler loss. */
const DEFAULT_RECESSION_FRACTION = 0.01
/** Keep the recession step small relative to nearby features. */
const MAX_RECESSION_FRACTION = 0.1

/** Cross-sectional area is in square millimeters and DC resistance is computed in SI units. */
const SQUARE_MILLIMETERS_PER_SQUARE_METER = 1e6

/** Check the panel count supported by the field discretization. */
function isPanelCountValid(panelsPerEdge: number): boolean {
  return Number.isInteger(panelsPerEdge) && panelsPerEdge >= MIN_PANELS_PER_EDGE
}

/** Resolve the default conductor edge resolution before starting a stepped solve. */
export function resolvePanelsPerEdge(
  panelsPerEdge: number = DEFAULT_PANELS_PER_EDGE,
): number {
  if (!isPanelCountValid(panelsPerEdge))
    fail({
      code: "cross_section_options",
      text: `Use an integer >=${MIN_PANELS_PER_EDGE} panels per edge`,
    })
  return panelsPerEdge
}

/** Check panel resolution and interface padding shared by the capacitance and full RLGC calculation. */
function hasValidMeshOptions({
  panelsPerEdge,
  interfaceExtent,
}: {
  panelsPerEdge: number
  interfaceExtent: number
}): boolean {
  return (
    isPanelCountValid(panelsPerEdge) &&
    Number.isFinite(interfaceExtent) &&
    interfaceExtent >= MIN_INTERFACE_EXTENT
  )
}

/** Calculate electrostatic capacitance without inductance or loss coefficients. */
export function calculateCapacitanceMatrix({
  crossSection,
  options = {},
}: {
  crossSection: CrossSection
  options?: Pick<CrossSectionOptions, "panelsPerEdge" | "interfaceExtent">
}): Matrix {
  validateCrossSection(crossSection)
  const {
    panelsPerEdge = DEFAULT_PANELS_PER_EDGE,
    interfaceExtent = DEFAULT_INTERFACE_EXTENT,
  } = options
  if (!hasValidMeshOptions({ panelsPerEdge, interfaceExtent }))
    fail({
      code: "cross_section_options",
      text: `Use >=${MIN_PANELS_PER_EDGE} panels per edge and interface extent >=${MIN_INTERFACE_EXTENT}`,
    })
  const capacitanceFaradsPerMeter = createZeroMatrix(
    crossSection.conductors.length,
  )
  for (const { region, conductorIndices } of partitionCrossSection(
    crossSection,
  )) {
    const field = calculateRegionField({
      region,
      panelsPerEdge,
      interfaceExtent,
      includeDielectricLoss: false,
    })
    for (const [i, globalRow] of conductorIndices.entries()) {
      for (const [j, globalColumn] of conductorIndices.entries())
        capacitanceFaradsPerMeter[globalRow][globalColumn] =
          field.capacitanceFaradsPerMeter[i][j]
    }
  }
  assertMatrixPassive({ matrix: capacitanceFaradsPerMeter, isStrict: true })
  return capacitanceFaradsPerMeter
}

/** Calculate quasi-TEM matrices with layered dielectrics and Wheeler conductor loss. */
export function calculateRlgc({
  crossSection,
  options = {},
}: {
  crossSection: CrossSection
  options?: CrossSectionOptions
}): RlgcMatrices {
  validateCrossSection(crossSection)
  const {
    panelsPerEdge = DEFAULT_PANELS_PER_EDGE,
    interfaceExtent = DEFAULT_INTERFACE_EXTENT,
    recessionFraction = DEFAULT_RECESSION_FRACTION,
  } = options
  const hasValidRecessionFraction =
    Number.isFinite(recessionFraction) &&
    recessionFraction > 0 &&
    recessionFraction <= MAX_RECESSION_FRACTION
  if (
    !hasValidMeshOptions({ panelsPerEdge, interfaceExtent }) ||
    !hasValidRecessionFraction
  ) {
    fail({
      code: "cross_section_options",
      text: `Use >=${MIN_PANELS_PER_EDGE} panels per edge, interface extent >=${MIN_INTERFACE_EXTENT} and recession fraction in (0, ${MAX_RECESSION_FRACTION}]`,
    })
  }
  const size = crossSection.conductors.length
  const capacitanceFaradsPerMeter = createZeroMatrix(size)
  const vacuumCapacitanceFaradsPerMeter = createZeroMatrix(size)
  const externalInductanceHenriesPerMeter = createZeroMatrix(size)
  const dielectricLossFaradsPerMeter = createZeroMatrix(size)
  const totalSkinResistanceOhmsPerMeterPerSqrtHz = createZeroMatrix(size)
  const conductorSkinResistanceOhmsPerMeterPerSqrtHz = createZeroMatrix(size)
  const dcResistanceOhmsPerMeter = createZeroMatrix(size)
  let panelCount = 0
  let reciprocityResidual = 0
  let recessionMm = Infinity
  for (const { region, conductorIndices } of partitionCrossSection(
    crossSection,
  )) {
    const mesh = { region, panelsPerEdge, interfaceExtent }
    const vacuumField = calculateRegionField({ ...mesh, isVacuum: true })
    const field = calculateRegionField(mesh)
    const external = calculateExternalInductance(
      vacuumField.capacitanceFaradsPerMeter,
    )
    const skin = calculateSkinCoefficients({ mesh, recessionFraction })
    for (const [i, globalRow] of conductorIndices.entries()) {
      for (const [j, globalColumn] of conductorIndices.entries()) {
        capacitanceFaradsPerMeter[globalRow][globalColumn] =
          field.capacitanceFaradsPerMeter[i][j]
        vacuumCapacitanceFaradsPerMeter[globalRow][globalColumn] =
          vacuumField.capacitanceFaradsPerMeter[i][j]
        externalInductanceHenriesPerMeter[globalRow][globalColumn] =
          external[i][j]
        dielectricLossFaradsPerMeter[globalRow][globalColumn] =
          field.dielectricLossFaradsPerMeter[i][j]
        totalSkinResistanceOhmsPerMeterPerSqrtHz[globalRow][globalColumn] =
          skin.totalSkinResistanceOhmsPerMeterPerSqrtHz[i][j]
        conductorSkinResistanceOhmsPerMeterPerSqrtHz[globalRow][globalColumn] =
          skin.conductorSkinResistanceOhmsPerMeterPerSqrtHz[i][j]
      }
    }
    panelCount += field.panelCount
    reciprocityResidual = Math.max(
      reciprocityResidual,
      field.reciprocityResidual,
      vacuumField.reciprocityResidual,
    )
    recessionMm = Math.min(recessionMm, skin.recessionMm)
  }
  for (const matrix of [
    capacitanceFaradsPerMeter,
    vacuumCapacitanceFaradsPerMeter,
    externalInductanceHenriesPerMeter,
  ])
    assertMatrixPassive({ matrix, isStrict: true })
  for (const matrix of [
    dielectricLossFaradsPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
  ])
    assertMatrixPassive({ matrix })
  for (const [i, c] of crossSection.conductors.entries()) {
    const conductivity = c.conductivitySm ?? defaultCopperConductivitySm
    dcResistanceOhmsPerMeter[i][i] =
      SQUARE_MILLIMETERS_PER_SQUARE_METER /
      (conductivity * c.widthMm * c.thicknessMm)
  }
  return {
    conductorIds: crossSection.conductors.map((c) => c.conductorId),
    capacitanceFaradsPerMeter,
    vacuumCapacitanceFaradsPerMeter,
    externalInductanceHenriesPerMeter,
    dielectricLossFaradsPerMeter,
    dcResistanceOhmsPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
    diagnostics: { panelCount, reciprocityResidual, recessionMm },
  }
}
