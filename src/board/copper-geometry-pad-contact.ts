import { hypotenuse, type Snapshot } from "../kernel"
import type { ExtractedCopper, TraceWire } from "./copper-geometry-types"
import type { CopperPoint } from "./geometry/types"
import type { PcbPortId } from "./ids"
import type { LayerRef } from "./schema"

/** Physical outlines and point contacts use the same tolerance as topology validation. */
export const CONTACT_TOLERANCE_MM = 1e-5

/** Compare physical endpoints on the copper geometry precision grid. */
function arePointsCoincident({
  first,
  second,
}: {
  first: Snapshot<CopperPoint>
  second: Snapshot<CopperPoint>
}): boolean {
  return (
    hypotenuse(first[0] - second[0], first[1] - second[1]) <
    CONTACT_TOLERANCE_MM
  )
}

/** Locate the wire a physical PCB pad contacts, including a via on that pad. */
export function findPadContactWire({
  geometry,
  layer,
  point,
  pcbPortId,
}: {
  geometry: Snapshot<ExtractedCopper>
  layer: LayerRef
  point: Snapshot<CopperPoint>
  pcbPortId?: PcbPortId
}): Snapshot<TraceWire> | undefined {
  const contact = geometry.padContacts.find(
    (contact) =>
      contact.layer === layer &&
      (pcbPortId === undefined || pcbPortId === contact.pcbPortId) &&
      arePointsCoincident({ first: contact.point, second: point }),
  )
  if (!contact) return undefined
  const wire = geometry.wires[contact.wireIndex]
  return wire
}
