// Planar polygon helpers for copper pours, mm.
import type { Snapshot } from "../../kernel"
import type { CopperPoint as Point, CopperPolygon as Polygon } from "./types"

/** The minimum and maximum coordinates of a ring. */
type RingBounds = [minX: number, minY: number, maxX: number, maxY: number]

const ringBounds = new WeakMap<Snapshot<Point[]>, RingBounds>()
/** Even-odd point-in-ring test, with a cached bounding box to reject far points quickly. */
function inRing({
  point,
  ring,
}: {
  point: Snapshot<Point>
  ring: Snapshot<Point[]>
}): boolean {
  let box = ringBounds.get(ring)
  if (!box) {
    box = [
      Math.min(...ring.map((p) => p[0])),
      Math.min(...ring.map((p) => p[1])),
      Math.max(...ring.map((p) => p[0])),
      Math.max(...ring.map((p) => p[1])),
    ]
    ringBounds.set(ring, box)
  }
  const [x, y] = point
  if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}
/** Point in outer ring and in no cutout. */
export function polygonContains({
  point,
  polygon,
}: {
  point: Snapshot<Point>
  polygon: Snapshot<Polygon>
}): boolean {
  if (!inRing({ point, ring: polygon[0] })) return false
  return !polygon.slice(1).some((ring) => inRing({ point, ring }))
}
