/**
 * simulation — experiments as declared on the board, the routed deck, and running it in ngspice.
 * Owns: SimulationPlan declaration from simulation_* records (timing, probes, stimuli, pin
 * states), electrical node mapping + ideal sources/passives, the converter run definition per
 * model, the channel netlist (ChannelNetlistSolver), the routed ladder/network deck
 * (RouteNetworkSolver), and the live transient (RouteTransientSolver).
 * Artifacts: electrical-node-map.json, simulation.cir, evidence.json and the transient capture.
 * Imports: kernel, solver, board, extraction, observation, buffers.
 */

export { branchSaves } from "./branch-saves"
export {
  type ChannelNetlist,
  type ChannelNetlistInput,
  ChannelNetlistSolver,
} from "./channel-netlist"
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
/** @internal */
export {
  buildReceiverGraphs,
  findReceiverPath,
  type ReceiverGraphs,
} from "./receiver-paths"
export type {
  RouteCompileOptions,
  RoutedCapture,
  RoutedDeck,
  RouteNetworkInput,
  TraceContacts,
} from "./route-inputs"
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
/** @internal */
export {
  circuitNodes,
  numberCircuitNodes,
  validateRoutedNodes,
} from "./routed-nodes"
/** @internal */
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

export {
  type ReceiverThreshold,
  receiverThreshold,
  roundStep,
  roundTicks,
  routeWaveformDrawing,
  type WaveformProbe,
  type WaveformState,
} from "./waveform-visual"
