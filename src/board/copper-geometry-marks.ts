import type { Circle, Line, Point } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { ExtractedCopper, WireJoin } from "./copper-geometry-types"
import type { CopperPoint } from "./geometry/types"
import { planColors } from "./plan-visual-types"

/** Use the same vertical axis for graphics and PCB coordinates. */
export function toBoardPoint([x, y]: Snapshot<CopperPoint>): Point {
  return { x, y }
}

/** Graphics circles have fixed stroke widths, so make a ring from two fills. */
function drawRing({
  point,
  radiusMm,
  borderMm,
  color,
  label,
}: {
  point: Snapshot<CopperPoint>
  radiusMm: number
  borderMm: number
  color: string
  label: string
}): Circle[] {
  const center = toBoardPoint(point)
  return [
    { center, radius: radiusMm, fill: color, label },
    { center, radius: radiusMm - borderMm, fill: "white", label },
  ]
}

/** Draw via barrels and pad contact points above the wires. */
export function drawContacts({
  geometry,
  unitMm,
}: {
  geometry: Snapshot<ExtractedCopper>
  unitMm: number
}): Circle[] {
  const borderMm = unitMm * 0.2
  return [
    ...geometry.padContacts.flatMap(({ point, layer }) =>
      drawRing({
        point,
        radiusMm: unitMm * 0.5,
        borderMm,
        color: planColors.ink,
        label: `Pad · ${layer}`,
      }),
    ),
    ...geometry.vias.flatMap(({ point, layers, outerDiameterMm }) =>
      drawRing({
        point,
        radiusMm: Math.max(outerDiameterMm / 2, unitMm * 0.55),
        borderMm: unitMm * 0.3,
        color: planColors.ideal,
        label: `Via · ${layers.join(" / ")}`,
      }),
    ),
  ]
}

/** Outline a dashed ideal join in white to keep it legible against solid copper. */
export function drawJoin({
  join,
  unitMm,
}: {
  join: Snapshot<WireJoin>
  unitMm: number
}): Line[] {
  const points = [join.fromPoint, join.toPoint].map(toBoardPoint)
  return [
    { points, strokeColor: "white", strokeWidth: unitMm * 0.48 },
    {
      points,
      strokeColor: planColors.ideal,
      strokeWidth: unitMm * 0.32,
      strokeDash: "2.5,1.5",
    },
  ]
}
