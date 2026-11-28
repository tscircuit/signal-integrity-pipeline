/** Calculates per-unit-length electrical matrices from 2D cross-sections. */
export {
  type CrossSection,
  type CrossSectionConductor,
  type CrossSectionDielectricLayer,
  type CrossSectionOptions,
  type CrossSectionPlane,
  calculateCapacitanceMatrix,
  calculateRlgc,
  type RlgcMatrices,
} from "./cross-section"
export { calculateMatrixInverse } from "./cross-section-matrix"
export type { DielectricMaterials } from "./dielectric-materials"
export {
  type TransmissionLineRlgcInput,
  TransmissionLineRlgcSolver,
} from "./transmission-line-rlgc"
export type {
  SolvedWireSection,
  TransmissionLineRlgc,
} from "./transmission-line-rlgc-types"
export { buildCrossSection } from "./wire-cross-section"
