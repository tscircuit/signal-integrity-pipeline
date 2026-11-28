import type { CopperPoint, CopperPolygon } from "./geometry/types"
import type {
  PcbCopperPourId,
  PcbPortId,
  PcbTraceId,
  PcbViaId,
  SourceNetId,
  SourceTraceId,
} from "./ids"
import type { LayerRef } from "./schema"
import type { BoardStackup } from "./stackup"

/** A direction vector normalized to one and without units. */
export type UnitDirection = [x: number, y: number]

/** An ideal connection from an original wire to the merged centerline. */
export interface WireJoin {
  fromPoint: CopperPoint
  toPoint: CopperPoint
  sourceTraceId: SourceTraceId
  pcbTraceId: PcbTraceId
}

/** A straight conductor with physical endpoints and projections on its canonical axes. */
export interface TraceWire {
  wireIndex: number
  pcbTraceId: PcbTraceId
  sourceTraceId: SourceTraceId
  layer: LayerRef
  widthMm: number
  startPoint: CopperPoint
  endPoint: CopperPoint
  direction: UnitDirection
  longitudinalMinMm: number
  longitudinalMaxMm: number
  lateralOffsetMm: number
  contributingPcbTraceIds?: PcbTraceId[]
  joins?: WireJoin[]
  startTouchesPad?: boolean
  endTouchesPad?: boolean
}

/** A copper surface or nearby edge used as an electrical reference. */
export interface ReferenceSurface {
  pcbCopperPourId: PcbCopperPourId
  sourceNetId: SourceNetId
  layer: LayerRef
  surfaceZMm: number
  lateralGapMm?: number
}

/** A longitudinal interval containing wires with a shared reference profile. */
export interface WireSection {
  wires: TraceWire[]
  startMm: number
  endMm: number
  references: ReferenceSurface[]
}

/** A physical via on every layer where it can contact routed copper. */
export interface CopperVia {
  pcbViaId?: PcbViaId
  pcbTraceId?: PcbTraceId
  sourceTraceId?: SourceTraceId
  sourceNetId?: SourceNetId
  layers: LayerRef[]
  point: CopperPoint
  outerDiameterMm: number
  holeDiameterMm?: number
}

/** A real pad contact and the wire reached from that pad. */
export interface PadContact {
  pcbPortId: PcbPortId
  point: CopperPoint
  layer: LayerRef
  wireIndex: number
}

/** A reference pour with an outline and any cutouts. */
export interface ReferencePour {
  pcbCopperPourId: PcbCopperPourId
  sourceNetId: SourceNetId
  layer: LayerRef
  polygon: CopperPolygon
}

/** Geometric conductors and the sections prepared for field extraction. */
export interface ExtractedCopper {
  stackup: BoardStackup
  wires: TraceWire[]
  sections: WireSection[]
  pours: ReferencePour[]
  vias: CopperVia[]
  padContacts: PadContact[]
  warnings: string[]
}
