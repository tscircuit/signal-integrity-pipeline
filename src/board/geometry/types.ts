// Port selectors, receiver trace paths and routed copper shapes shared by channel planning and the routed stages.
import type {
  PcbTraceRoutePointVia,
  PcbTraceRoutePointWire,
  SourceTrace,
} from "circuit-json"
import type { SourcePortId } from "../ids"

export type {
  PcbTrace,
  PcbTraceRoutePoint as RoutePoint,
  SourcePort,
} from "circuit-json"

export type PortSelector =
  | {
      sourcePortId: SourcePortId
      component?: never
      port?: never
    }
  | {
      sourcePortId?: never
      component: string
      port: string
    }
export interface LaneModeling {
  port: string
  from: PortSelector
  to: PortSelector
  sourceTraceId?: SourceTrace["source_trace_id"]
}
/** A trace route point on a wire or via. */
export type RoutedPoint = PcbTraceRoutePointWire | PcbTraceRoutePointVia

/** One driver-to-receiver path; `sourceTraceIds` lists its routed traces in path order. */
export interface ReceiverTracePath {
  readonly channelName: string
  readonly sourceTraceId: SourceTrace["source_trace_id"]
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
  readonly sourceTraceIds?: readonly SourceTrace["source_trace_id"][]
}

/** Copper outlines in mm. */
export type CopperPoint = [number, number]
/** The copper outline ring followed by any cutout rings. */
export type CopperPolygon = CopperPoint[][]
