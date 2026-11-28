/**
 * board — everything known about the physical board, read from Circuit JSON.
 * Owns: Circuit JSON admission (zod record schemas, subcircuit scope), stackup, port selection,
 * the channel copper scope, routed section geometry (CopperGeometryExtractionSolver) and board drawings.
 * Imports: kernel.
 */

/** @internal */
export {
  type ConnectivityMap,
  crossesDifferentialLegs,
  getSourcePortConnectivityMapFromCircuitJson,
  hasBuiltInPassiveModel,
  type PassiveBridge,
  passiveBridges,
  sourceConnections,
  sourceNetMembers,
  sourcePinTies,
} from "./connectivity"
export {
  type CopperGeometry,
  CopperGeometryExtractionSolver,
} from "./copper-geometry-extraction"
export type { CopperGeometryExtractionInput } from "./copper-geometry-extraction-input"
export { CopperGeometryExtractionStage } from "./copper-geometry-extraction-stage"
export {
  extractCopperGeometry,
  stepCopperGeometryExtraction,
} from "./copper-geometry-extraction-steps"
export { findPadContactWire } from "./copper-geometry-pad-contact"
export { findWireReferences } from "./copper-geometry-references"
export type {
  ExtractedCopper,
  ReferenceSurface,
  TraceWire,
  WireSection,
} from "./copper-geometry-types"
export { getWirePoint } from "./copper-geometry-wire"
export { polygonContains } from "./geometry/polygon"
export { resolveRouteVias, selectPort } from "./geometry/ports"
export { type CopperScope, channelCopperScope } from "./geometry/scope"
export type {
  CopperPoint,
  CopperPolygon,
  LaneModeling,
  PcbTrace,
  PortSelector,
  ReceiverTracePath,
  RoutedPoint,
  RoutePoint,
  SourcePort,
} from "./geometry/types"
export type {
  SignalEndpointPortIds,
  SimulationPcbTransientChannelSimulationId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "./ids"
/** @internal */
export type { PlanHeaderRow } from "./plan-header"
/** @internal */
export { getPinName, indexPlanPorts } from "./plan-view"
/** @internal */
export { renderPlanDrawing } from "./plan-visual"
/** @internal */
export {
  getTraceColor,
  type PlanOverlay,
  type PlanTrace,
  type PlanVisualEndpoint,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"
export {
  getBoardBounds,
  getPointBounds,
  type RouteFrame,
  type RouteNet,
  type RouteView,
  routeBoardDrawing,
  routeBuffers,
  routeCanvas,
  routeDisplayItems,
  routeFailure,
  routeFrame,
  routeHue,
  routeMarks,
  routeNets,
  routeOutline,
  routePane,
  routePinDirection,
  routePortPoint,
  routeStroke,
  routeText,
  routeTones,
  routeVia,
  routeView,
  withRouteDrawing,
} from "./route-visual"
export {
  type RouteStripRow,
  routeLengths,
  routeStrip,
  routeUnrolled,
} from "./route-visual-strip"
export type {
  CircuitJson,
  Point,
  SimulationExperiment,
  SimulationIbisModel,
} from "./schema"
export {
  cloneCircuitJson,
  recordSchema,
  validateCircuitRecords,
} from "./schema"
export {
  type DriverPattern,
  endpointPorts,
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
