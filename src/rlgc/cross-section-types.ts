import type { Matrix } from "../kernel"

/** A rectangular conductor; z is its lower face, x its center. All geometry is in mm, z increases upwards. */
export interface CrossSectionConductor {
  conductorId: string
  xMm: number
  zMm: number
  widthMm: number
  thicknessMm: number
  conductivitySm?: number
}
/** An infinite equipotential reference surface, with copper on the side away from the conductors. */
export interface CrossSectionPlane {
  zMm: number
  conductivitySm?: number
}
/** A horizontally infinite dielectric layer, including planar soldermask. Unspecified space is lossless air. */
export interface CrossSectionDielectricLayer {
  zMm: number
  thicknessMm: number
  relativePermittivity: number
  lossTangent: number
}
/** A quasi-TEM cross-section. Solid reference planes separate independent field regions. */
export interface CrossSection {
  conductors: CrossSectionConductor[]
  planes: CrossSectionPlane[]
  dielectricLayers: CrossSectionDielectricLayer[]
}
/** Fixed, bounded discretization; increase panel count and interface extent independently to check convergence. */
export interface CrossSectionOptions {
  panelsPerEdge?: number
  /** Padding beyond the conductor projections, in cross-section spans or in plane spacings / π for stripline. */
  interfaceExtent?: number
  recessionFraction?: number
}
/** Resolution, raw reciprocity error and wall displacement of a field solve. */
interface CrossSectionDiagnostics {
  panelCount: number
  reciprocityResidual: number
  recessionMm: number
}

/** Per-unit-length matrices in SI units, indexed by conductorIds in input order. */
export interface RlgcMatrices {
  conductorIds: CrossSectionConductor["conductorId"][]
  capacitanceFaradsPerMeter: Matrix
  vacuumCapacitanceFaradsPerMeter: Matrix
  externalInductanceHenriesPerMeter: Matrix
  /** Multiply by 2πf to get conductance in siemens per meter at frequency f in hertz. */
  dielectricLossFaradsPerMeter: Matrix
  /** Ohm/m at DC; infinite reference planes have zero DC resistance. */
  dcResistanceOhmsPerMeter: Matrix
  /** High-frequency Wheeler resistance divided by sqrt(f in Hz), in ohm/m/sqrt(Hz). */
  totalSkinResistanceOhmsPerMeterPerSqrtHz: Matrix
  /** Skin coefficient from the conductor walls with the reference planes held fixed. */
  conductorSkinResistanceOhmsPerMeterPerSqrtHz: Matrix
  diagnostics: CrossSectionDiagnostics
}

/** Vacuum permittivity in farads per meter. */
export const VACUUM_PERMITTIVITY_F_PER_M = 8.8541878128e-12
/** Vacuum permeability in henries per meter. */
export const VACUUM_PERMEABILITY_H_PER_M = 1.25663706212e-6
/** A constant-charge boundary element, carrying total equivalent charge divided by epsilon0. */
export interface BoundaryPanel {
  centerXMm: number
  centerZMm: number
  tangentX: number
  tangentZ: number
  lengthMm: number
  conductorIndex: number
  relativePermittivity: number
  lossTangent: number
  permittivityContrast: number
  contrastLossDerivative: number
}
/** One region above a lower plane and, optionally, below an upper plane, with local z coordinates. */
export interface FieldRegion {
  conductors: CrossSectionConductor[]
  dielectricLayers: CrossSectionDielectricLayer[]
  planeSpacingMm: number
  lowerPlaneConductivitySm: number
  upperPlaneConductivitySm: number
}

/** Discretize one region with or without its dielectric layers. */
export interface RegionMeshInput {
  region: FieldRegion
  panelsPerEdge: number
  interfaceExtent: number
  isVacuum?: boolean
  includeDielectricLoss?: boolean
  facePanelCounts?: number[]
}
