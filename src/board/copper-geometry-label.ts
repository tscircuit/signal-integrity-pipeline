import { Point, Segment } from "@flatten-js/core"
import type { Text } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type {
  ReferencePour,
  UnitDirection,
  WireSection,
} from "./copper-geometry-types"
import { getWirePoint, roundWireCoordinate } from "./copper-geometry-wire"
import type { CopperPoint } from "./geometry/types"

/** Estimate the average advance of a character in the section annotation. */
const SECTION_LABEL_ADVANCE_EM = 0.5

/** Find which side of the wire contains the closest edge of the reference pour. */
function getPourSide({
  center,
  normal,
  pour,
}: {
  center: CopperPoint
  normal: UnitDirection
  pour: Snapshot<ReferencePour>
}): number {
  const centerPoint = new Point(...center)
  let side = 0
  let gapMm = Infinity
  for (const ring of pour.polygon) {
    for (const [index, start] of ring.entries()) {
      const end = ring[(index + 1) % ring.length]
      const edge = new Segment(new Point(...start), new Point(...end))
      const [distanceMm, nearest] = centerPoint.distanceTo(edge)
      if (distanceMm >= gapMm) continue
      gapMm = distanceMm
      const offsetMm =
        (nearest.end.x - center[0]) * normal[0] +
        (nearest.end.y - center[1]) * normal[1]
      side = Math.sign(roundWireCoordinate(offsetMm))
    }
  }
  return side
}

/** Place the text box on the outward side of its anchor for any normal. */
function getTextAnchor([x, y]: UnitDirection): NonNullable<Text["anchorSide"]> {
  let horizontal: "left" | "center" | "right" = "center"
  let vertical: "top" | "center" | "bottom" = "center"
  if (roundWireCoordinate(x) > 0) horizontal = "left"
  if (roundWireCoordinate(x) < 0) horizontal = "right"
  if (roundWireCoordinate(y) > 0) vertical = "bottom"
  if (roundWireCoordinate(y) < 0) vertical = "top"
  if (vertical !== "center") return `${vertical}_${horizontal}`
  if (horizontal === "center") return "center"
  return `center_${horizontal}`
}

/** Anchor at the first wire and clear the group's copper on the selected side. */
export function drawSectionLabel({
  section,
  pours,
  label,
  color,
  unitMm,
}: {
  section: Snapshot<WireSection>
  pours: Snapshot<ReferencePour[]>
  label: string
  color: string
  unitMm: number
}): Text | undefined {
  const { startMm, endMm, wires, references } = section
  const [firstWire] = wires
  if (!firstWire) return undefined
  const [directionX, directionY] = firstWire.direction
  const normal: UnitDirection = [-directionY, directionX]
  const center = getWirePoint({
    wire: firstWire,
    positionMm: (startMm + endMm) / 2,
  })
  const wireLayers = [...new Set(wires.map(({ layer }) => layer))].join(" / ")
  const text = `${wireLayers} · ${label}`
  const fontSize = unitMm * 1.65
  const marginMm = unitMm * 0.9
  const firstEdgeMm = firstWire.widthMm / 2
  let side = 1
  if (text.length * fontSize * SECTION_LABEL_ADVANCE_EM > endMm - startMm)
    side = -1
  const edgeReference = references.find(
    ({ lateralGapMm }) =>
      lateralGapMm !== undefined &&
      lateralGapMm < firstEdgeMm + marginMm + fontSize,
  )
  const edgePour = pours.find(
    ({ pcbCopperPourId }) => pcbCopperPourId === edgeReference?.pcbCopperPourId,
  )
  if (edgePour) {
    const pourSide = getPourSide({ center, normal, pour: edgePour })
    if (pourSide !== 0) side = -pourSide
  }
  let offsetMm = -(firstEdgeMm + marginMm)
  if (side > 0) {
    const lastEdgeMm = Math.max(
      ...wires.map(
        ({ lateralOffsetMm, widthMm }) => lateralOffsetMm + widthMm / 2,
      ),
    )
    offsetMm = lastEdgeMm - firstWire.lateralOffsetMm + marginMm
  }
  return {
    x: center[0] + normal[0] * offsetMm,
    y: center[1] + normal[1] * offsetMm,
    text,
    fontSize,
    anchorSide: getTextAnchor([normal[0] * side, normal[1] * side]),
    color,
  }
}
