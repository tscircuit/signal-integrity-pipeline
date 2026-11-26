/**
 * simulation — experiments as declared on the board, the routed deck, and running it in ngspice.
 * Owns: SimulationPlan declaration from simulation_* records (timing, probes, stimuli, pin
 * states), electrical node mapping + ideal sources/passives, the converter run definition per
 * model, the routed ladder/network deck (RouteBindingsSolver, RouteNetworkSolver) and the live
 * transient (RouteTransientSolver).
 * Artifacts: electrical-node-map.json, simulation.cir, evidence.json and the transient capture.
 * Imports: kernel, solver, board, extraction, observation, buffers.
 */

export { buildConnectionGraph, findConnectionPath } from "./connection-paths"
export {
  generalDeclarations,
  modelRunDefinition,
} from "./declarations"
export {
  electricalSources,
  namespaceSpice,
  voltageSourceTerminals,
} from "./netlist"
export {
  buildReceiverGraphs,
  findReceiverPath,
  type ReceiverGraphs,
} from "./receiver-paths"
export type {
  RouteBindingsInput,
  RouteCompileOptions,
  TraceContacts,
} from "./route-inputs"
export {
  circuitNodes,
  numberCircuitNodes,
  validateRoutedNodes,
} from "./routed-nodes"
export { collectSignalRailIds, type SignalRailIds } from "./signal-rails"
export { transmittedBits } from "./stimulus"
export type {
  CircuitNodes,
  Declarations,
  ElectricalSources,
  PipelineIbisModel,
  RunControls,
  SimulationModeling,
  SimulationPlan,
  VoltageProbePlan,
} from "./types"
