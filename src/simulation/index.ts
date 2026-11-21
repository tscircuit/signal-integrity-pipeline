/**
 * simulation — experiments as declared on the board, the routed deck, and running it in ngspice.
 * Owns: SimulationPlan declaration from simulation_* records (timing, probes, stimuli, pin
 * states), electrical node mapping + ideal sources/passives, the converter run definition per
 * model, the routed ladder/network deck (RouteBindingsSolver, RouteNetworkSolver) and the live
 * transient (RouteTransientSolver).
 * Artifacts: electrical-node-map.json, simulation.cir, evidence.json and the transient capture.
 * Imports: kernel, solver, board, extraction, observation, buffers.
 */

export { branchSaves } from "./branch-saves"
export {
  circuitNodes,
  generalDeclarations,
  modelRunDefinition,
} from "./declarations"
export {
  electricalSources,
  namespaceSpice,
  voltageSourceTerminals,
} from "./netlist"
export { RouteBindingsSolver } from "./route-bindings"
export { type RouteLadder, routeLadder } from "./route-ladder"
export { RouteNetworkSolver } from "./route-network"
export { routeOblique } from "./route-oblique"
export { RouteTransientSolver } from "./route-transient"
export {
  barrelCapacitance,
  barrelInductance,
  type RouteTransitions,
  routeTransitions,
  terminalInductance,
} from "./route-transitions"
export { routedControl } from "./routed-control"
export type {
  RouteBindingsInput,
  RoutedBindings,
  RoutedCapture,
  RoutedCompileOptions,
  RoutedDeck,
  RouteNetworkInput,
} from "./routed-types"
export { MAX_STIMULUS_BITS, transmittedBits } from "./stimulus"
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

export {
  type ReceiverThreshold,
  receiverThreshold,
  roundStep,
  roundTicks,
  routeWaveformDrawing,
  type WaveformProbe,
  type WaveformState,
} from "./waveform-visual"
