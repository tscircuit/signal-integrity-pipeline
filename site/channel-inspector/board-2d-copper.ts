import type { Matrix } from "@tscircuit/circuit-json-webgpu"
import type { LayerRef, Point } from "circuit-json"
import { addBrepShapeToPath } from "circuit-to-canvas"
import { type CopperCategory, copperCategories } from "./copper"
import type { InspectorFeature, InspectorShape } from "./geometry"

/** Mix a small amount of white into the renderer's usual copper colors. */
const lift: Record<CopperCategory, number> = {
  selected: 0.23,
  near: 0.13,
  rail: 0.08,
  far: 0,
}
const ACTIVE_LIFT = 0.34
const PICK_WIDTH_PX = 5
const WORLD: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Build the path used by picking and the translucent interaction layer. */
function copperPath({
  context,
  feature,
  shape,
}: {
  context: CanvasRenderingContext2D
  feature: InspectorFeature
  shape: InspectorShape
}): void {
  context.beginPath()
  if (shape.shape === "wire") {
    context.moveTo(shape.start.x, shape.start.y)
    context.lineTo(shape.end.x, shape.end.y)
    return
  }
  if (shape.shape === "via") {
    const { x, y } = shape.center
    context.arc(x, y, shape.diameter / 2, 0, 2 * Math.PI)
    if (feature.record.type === "pcb_via") {
      const radius = feature.record.hole_diameter / 2
      context.moveTo(x + radius, y)
      context.arc(x, y, radius, 0, 2 * Math.PI)
    }
    return
  }
  if (
    feature.record.type === "pcb_copper_pour" &&
    feature.record.shape === "brep"
  ) {
    addBrepShapeToPath({
      ctx: context,
      // The Canvas drawer only reads the rings.
      shape: feature.record.brep_shape as Parameters<
        typeof addBrepShapeToPath
      >[0]["shape"],
      realToCanvasMat: WORLD,
    })
    return
  }
  for (const [start, ...vertices] of shape.rings) {
    if (!start) continue
    context.moveTo(start.x, start.y)
    for (const point of vertices) context.lineTo(point.x, point.y)
    context.closePath()
  }
}

/** Find the nearest visible copper under the cursor, with pours behind pads and tracks. */
export function pickCopper({
  context,
  features,
  cursor,
  pixels,
  activeLayer,
  scale,
}: {
  context: CanvasRenderingContext2D
  features: readonly InspectorFeature[]
  cursor: Point
  pixels: Point
  activeLayer?: LayerRef
  scale: number
}): InspectorFeature | undefined {
  const slop = PICK_WIDTH_PX / scale
  let best: InspectorFeature | undefined
  let bestPriority = -1
  for (const feature of features) {
    for (const shape of feature.shapes) {
      let priority = Number(
        activeLayer !== undefined && shape.layers.includes(activeLayer),
      )
      if (shape.shape !== "region") priority += 2
      if (shape.shape === "wire") {
        const { start, end, width } = shape
        const margin = Math.max(width, slop) / 2
        if (
          cursor.x < Math.min(start.x, end.x) - margin ||
          cursor.x > Math.max(start.x, end.x) + margin ||
          cursor.y < Math.min(start.y, end.y) - margin ||
          cursor.y > Math.max(start.y, end.y) + margin
        )
          continue
      } else if (priority <= bestPriority && shape.shape === "region") {
        continue
      }
      if (
        shape.shape === "via" &&
        Math.hypot(cursor.x - shape.center.x, cursor.y - shape.center.y) >
          shape.diameter / 2
      )
        continue
      copperPath({ context, feature, shape })
      if (shape.shape === "wire") {
        context.lineWidth = shape.width
        if (context.isPointInStroke(pixels.x, pixels.y)) priority += 2
        else {
          if (priority <= bestPriority || slop <= shape.width) continue
          context.lineWidth = slop
          if (!context.isPointInStroke(pixels.x, pixels.y)) continue
        }
      } else {
        if (!context.isPointInPath(pixels.x, pixels.y, "evenodd")) continue
        if (shape.shape === "via") priority += 2
      }
      if (priority <= bestPriority) continue
      best = feature
      bestPriority = priority
    }
  }
  return best
}

/** Emphasize scope roles and outline the linked workbench selection. */
export function drawCopperEmphasis({
  context,
  features,
  transform,
  activeId,
}: {
  context: CanvasRenderingContext2D
  features: readonly InspectorFeature[]
  transform: Matrix
  activeId?: string
}): void {
  context.resetTransform()
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.setTransform(transform)
  context.lineCap = "round"
  context.strokeStyle = "#fff"
  context.fillStyle = "#fff"
  for (const category of [...copperCategories].reverse()) {
    for (const feature of features) {
      if (feature.category !== category) continue
      const active = feature.id === activeId
      context.globalAlpha = active ? ACTIVE_LIFT : lift[category]
      if (context.globalAlpha === 0) continue
      for (const shape of feature.shapes) {
        copperPath({ context, feature, shape })
        if (shape.shape === "wire") {
          context.lineWidth = shape.width
          context.stroke()
        } else if (shape.shape === "region") {
          context.lineWidth = 1 / transform.a
          context.stroke()
        } else {
          context.fill("evenodd")
        }
      }
    }
  }
  context.globalAlpha = 1
}
