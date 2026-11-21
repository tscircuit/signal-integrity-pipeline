/**
 * extraction — what the channel is electrically.
 * Owns: quasi-TEM 2D cross-section extraction (field solve, per-unit-length RLGC),
 * per-route section lines and coupling (RouteFieldsSolver), and the matrix checks they need.
 * Imports: kernel, board.
 */

export { type MatrixCheck, validateMatrix } from "./checks"
export {
  type CrossSection,
  type CrossSectionOptions,
  type CrossSectionResult,
  type SectionConductor,
  type SectionDielectric,
  type SectionPlane,
  solveCrossSection,
  solveSectionCapacitance,
} from "./cross-section"
export type { Matrix } from "./linalg"
export { multiply, sum, symmetrize, transpose } from "./linalg"
