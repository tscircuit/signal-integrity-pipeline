import type { Polygon } from "@flatten-js/core"
import {
  type cju,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getViaPolygon,
} from "@tscircuit/circuit-json-util"
import type { PcbPort } from "circuit-json"
import type { Snapshot } from "../kernel"
import {
  type ConnectivityMap,
  getTraceMembers,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "./connectivity"
import {
  getWireOutlines,
  type WireOutline,
} from "./copper-geometry-contact-outlines"
import { CONTACT_TOLERANCE_MM } from "./copper-geometry-pad-contact"
import type { WireChord } from "./copper-geometry-simplify"
import type {
  CopperVia,
  ExtractedCopper,
  PadContact,
  TraceWire,
} from "./copper-geometry-types"
import type { UnionedWire } from "./copper-geometry-union"
import { getViaMembers } from "./copper-geometry-vias"
import type { CopperScope } from "./geometry/scope"
import type { LayerRef } from "./schema"

/** A pad outline in contact with zero or more planar conductors. */
interface PadOutline {
  pcbPort: PcbPort
  layer: LayerRef
  outline: Polygon
}

/** Physical pad contacts and modeled wires with their endpoint flags. */
type PadContacts = Pick<ExtractedCopper, "wires" | "padContacts">

/** Read physical pads and plated holes connected to PCB ports. */
function getPadOutlines(db: ReturnType<typeof cju>): PadOutline[] {
  const smtPads = db.pcb_smtpad.list().flatMap((pad): PadOutline[] => {
    if (pad.pcb_port_id === undefined) return []
    const pcbPort = db.pcb_port.get(pad.pcb_port_id)
    if (!pcbPort) return []
    return [{ pcbPort, layer: pad.layer, outline: getSmtPadPolygon(pad) }]
  })
  const platedHoles = db.pcb_plated_hole
    .list()
    .flatMap((hole): PadOutline[] => {
      if (hole.pcb_port_id === undefined) return []
      const pcbPort = db.pcb_port.get(hole.pcb_port_id)
      if (!pcbPort) return []
      let rotationDegrees: number | undefined
      if (hole.pcb_component_id !== undefined)
        rotationDegrees = db.pcb_component.get(hole.pcb_component_id)?.rotation
      const outline = getPlatedHolePolygon(hole, rotationDegrees)
      return hole.layers.map((layer) => ({ pcbPort, layer, outline }))
    })
  return [...smtPads, ...platedHoles]
}

/** Check contact against measured via copper, including the drill bore. */
function touchesVia({
  outline,
  via,
}: {
  outline: Polygon
  via: CopperVia
}): boolean {
  const { outerDiameterMm, holeDiameterMm } = via
  if (
    !Number.isFinite(outerDiameterMm) ||
    holeDiameterMm === undefined ||
    !Number.isFinite(holeDiameterMm) ||
    holeDiameterMm <= 0 ||
    holeDiameterMm >= outerDiameterMm
  )
    return false
  const [x, y] = via.point
  const barrel = getViaPolygon({ x, y }, outerDiameterMm, holeDiameterMm)
  return outlinesTouch({ first: outline, second: barrel })
}

/** Test coplanar contact with the same occupied outlines used by topology. */
function outlinesTouch({
  first,
  second,
}: {
  first: Polygon
  second: Polygon
}): boolean {
  return (
    first.box.extend(CONTACT_TOLERANCE_MM).intersect(second.box) &&
    copperPolygonsTouch(first, second, CONTACT_TOLERANCE_MM)
  )
}

/** A via with its declared electrical associations resolved through the source circuit. */
interface AssociatedVia {
  via: CopperVia
  members: SourceConnectionGroup
}

/** Look for a physical pad or via connection to a compatible planar conductor. */
function findPadWire({
  pad,
  wireOutlines,
  vias,
  netMembers,
}: {
  pad: PadOutline
  wireOutlines: WireOutline[]
  vias: AssociatedVia[]
  netMembers: ReadonlySet<SourceConnectionGroup[number]>
}): TraceWire | undefined {
  const direct = wireOutlines.find(
    ({ modeledWire, outline }) =>
      modeledWire.layer === pad.layer &&
      outlinesTouch({ first: pad.outline, second: outline }),
  )
  if (direct) return direct.modeledWire
  for (const { via, members } of vias) {
    if (
      !members.length ||
      !members.every((memberId) => netMembers.has(memberId)) ||
      !via.layers.includes(pad.layer) ||
      !touchesVia({ outline: pad.outline, via })
    )
      continue
    const connected = wireOutlines.find(
      ({ modeledWire, outline }) =>
        via.layers.includes(modeledWire.layer) && touchesVia({ outline, via }),
    )
    if (connected) return connected.modeledWire
  }
  return undefined
}

/** Resolve the pads on the same nets as modeled wires and mark their ends. */
export function resolvePadContacts({
  db,
  connectivity,
  chords,
  mergedWires,
  vias,
  copperScope,
}: {
  db: ReturnType<typeof cju>
  connectivity: ConnectivityMap
  chords: WireChord[]
  mergedWires: UnionedWire[]
  vias: CopperVia[]
  copperScope: Snapshot<CopperScope>
}): PadContacts {
  const pads = getPadOutlines(db)
  const wireOutlines = getWireOutlines({ mergedWires, chords, copperScope })
  const traceMembers = new Map(
    db.source_trace
      .list()
      .map((trace) => [trace.source_trace_id, getTraceMembers(trace)]),
  )
  const associatedVias = vias.map((via) => ({
    via,
    members: getViaMembers({ db, via, traceMembers }),
  }))
  const padContacts: PadContact[] = []
  const startContactWireIndices = new Set<number>()
  const endContactWireIndices = new Set<number>()
  for (const pad of pads) {
    const netMembers = sourceNetMembers({
      connectivity,
      memberId: pad.pcbPort.source_port_id,
    })
    const compatibleWires = wireOutlines.filter(({ physicalWire }) =>
      traceMembers
        .get(physicalWire.sourceTraceId)
        ?.some((memberId) => netMembers.has(memberId)),
    )
    for (const { modeledWire, startCap, endCap } of compatibleWires) {
      if (pad.layer !== modeledWire.layer) continue
      if (startCap && outlinesTouch({ first: startCap, second: pad.outline }))
        startContactWireIndices.add(modeledWire.wireIndex)
      if (endCap && outlinesTouch({ first: endCap, second: pad.outline }))
        endContactWireIndices.add(modeledWire.wireIndex)
    }
    const wire = findPadWire({
      pad,
      wireOutlines: compatibleWires,
      vias: associatedVias,
      netMembers,
    })
    if (wire)
      padContacts.push({
        pcbPortId: pad.pcbPort.pcb_port_id,
        point: [pad.pcbPort.x, pad.pcbPort.y],
        layer: pad.layer,
        wireIndex: wire.wireIndex,
      })
  }
  return {
    padContacts,
    wires: mergedWires.map(({ wire }) => ({
      ...wire,
      startTouchesPad: startContactWireIndices.has(wire.wireIndex),
      endTouchesPad: endContactWireIndices.has(wire.wireIndex),
    })),
  }
}
