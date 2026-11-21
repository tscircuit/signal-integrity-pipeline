/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the declared board geometry and its routed sections.
 * Imports: kernel.
 */

export {
  type ConnectivityMap,
  getSourcePortConnectivityMapFromCircuitJson,
  type PassiveBridge,
  passiveBridges,
  sourceConnections,
  sourceNetMembers,
} from "./connectivity"
export { polygonContains } from "./geometry/polygon"
export { resolveRouteVias, selectPort } from "./geometry/ports"
export { type CopperScope, channelCopperScope } from "./geometry/scope"
export type {
  CopperPoint,
  CopperPolygon,
  LaneMapping,
  LaneModeling,
  PcbTrace,
  PortSelector,
  RoutedPoint,
  RoutePoint,
  SourcePort,
} from "./geometry/types"
export type {
  SignalEndpointPortIds,
  SimulationBlockId,
  SourceNetId,
  SourcePortId,
} from "./ids"
export type {
  CircuitJson,
  SimulationExperiment,
  SimulationIbisModel,
} from "./schema"
export { recordSchema, validateCircuitRecords } from "./schema"
export {
  isQuiet,
  type SignalEndpoint,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
} from "./signals"
export {
  type BoardStackup,
  type CopperLayer,
  type DielectricLayer,
  defaultCopperConductivitySm,
  stackupFromCircuitJson,
} from "./stackup"
export { type SubcircuitTree, subcircuitTree } from "./subcircuit"
