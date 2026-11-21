import type { Matrix } from "./linalg"

/** A rectangular trace; z is its lower face, x its centre. All geometry is in mm, z increases upwards. */
export interface SectionConductor {
  id: string
  xMm: number
  zMm: number
  widthMm: number
  thicknessMm: number
  conductivitySm?: number
}
/** An infinite equipotential reference surface, with copper on the side away from the signals. */
export interface SectionPlane {
  zMm: number
  conductivitySm?: number
}
/** A horizontally infinite slab, including planar soldermask. Unspecified space is lossless air. */
export interface SectionDielectric {
  zMm: number
  thicknessMm: number
  er: number
  lossTangent: number
}
/** A quasi-TEM cross-section. Solid reference planes separate independent field regions. */
export interface CrossSection {
  conductors: SectionConductor[]
  planes: SectionPlane[]
  dielectrics: SectionDielectric[]
}
/** Fixed, bounded discretisation; increase panel count and extent independently to check convergence. */
export interface CrossSectionOptions {
  panelsPerEdge?: number
  interfaceExtent?: number
  recessionFraction?: number
}
/** Resolution, raw reciprocity error and wall displacement of a field solve. */
interface CrossSectionDiagnostics {
  panels: number
  reciprocityResidual: number
  recessionMm: number
}

/** Per-unit-length matrices in SI units, indexed by conductorIds in input order. */
export interface CrossSectionResult {
  conductorIds: SectionConductor["id"][]
  C: Matrix
  C0: Matrix
  L: Matrix
  /** Sum(er * tan(delta) * dC/d(er)); G(f) = 2*pi*f*dielectricLoss. Units F/m. */
  dielectricLoss: Matrix
  /** Ohm/m at DC; infinite reference planes have zero DC resistance. */
  dcResistance: Matrix
  /** High-frequency Wheeler resistance divided by sqrt(f in Hz), in ohm/m/sqrt(Hz). */
  skinResistance: Matrix
  /** The share of skinResistance from the signal conductors' own walls (planes held fixed); the rest is plane loss. */
  stripSkinResistance: Matrix
  diagnostics: CrossSectionDiagnostics
}

/** Vacuum permittivity in farads per meter. */
export const sectionEpsilon0 = 8.8541878128e-12
/** Vacuum permeability in henries per meter. */
export const sectionMu0 = 1.25663706212e-6
/** Default conductivity of copper in siemens per meter. */
export const copperConductivity = 5.8e7

/** A constant-charge boundary element, carrying total equivalent charge divided by epsilon0. */
export interface SectionPanel {
  x: number
  z: number
  tx: number
  tz: number
  length: number
  group: number
  er: number
  tangent: number
  contrast: number
  derivative: number
}
/** One region above a lower plane and, optionally, below an upper plane, with local z coordinates. */
export interface SectionRegion {
  conductors: SectionConductor[]
  dielectrics: SectionDielectric[]
  height: number
  lowerConductivity: number
  upperConductivity: number
}

/** Discretize one region with or without its dielectric layers. */
export interface SectionMeshInput {
  region: SectionRegion
  count: number
  extent: number
  vacuum?: boolean
}
