/**
 * extraction — what the channel is electrically.
 * Owns: quasi-TEM 2D cross-section extraction (field solve, per-unit-length RLGC, causal loss),
 * per-route section lines and coupling (RouteFieldsSolver), and the matrix checks they need.
 * Imports: kernel, board.
 */

export {
  causalLossPoles,
  causalLossResponse,
  crossoverPoles,
  type LossPole,
  skinCrossover,
} from "./causal-loss"
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
export { type RouteFieldsInput, RouteFieldsSolver } from "./route-fields-solver"
export {
  closestRoutePoints,
  type ExtractedRouteSlice,
  type ExtractedRoutes,
  type RouteCoefficients,
  type RouteMaterials,
  referenceSeries,
  routeCrossSection,
} from "./route-lines"
