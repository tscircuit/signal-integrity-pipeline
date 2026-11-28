// Root entry: pure (no node:*). Re-exports module surfaces only (check-modules S5).

export type { CircuitJson } from "./board"
export { stackupFromCircuitJson } from "./board"
export type { IbisSources } from "./buffers"
export type { Diagnostic, DiagnosticSubject, FileMap } from "./kernel"
export type { DiagnosticCode } from "./modules.generated"
export type {
  RoutedInspection,
  TransientChannelSimulationPlanInput,
} from "./pipeline"
export { RoutedPipelineSolver } from "./pipeline"
export { RouteTransientSolver, transmittedBits } from "./simulation"
export type { RunSolver, Solver, SolverRequest, SolverResult } from "./solver"
