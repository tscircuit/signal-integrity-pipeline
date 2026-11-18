import type { GraphicsObject, Point, Viewbox } from "graphics-debug"
import {
  type CircuitJson,
  type CopperScope,
  type RouteFrame,
  type RouteSlice,
  type RouteView,
  type RouteXY,
  routeBounds,
  routeCanvas,
  routeDisplayItems,
  routeFailure,
  routeFrame,
  routeNets,
  routePane,
  routePosition,
  routeStroke,
  routeText,
  routeTones,
  routeView,
  type SectionGeometry,
} from "../board"
import type { CrossSection } from "./cross-section-types"
import type {
  ExtractedRouteSlice,
  RouteCoefficients,
  RouteMaterials,
} from "./route-lines"

/** Characteristic impedance of conductor `i` from its self terms. */
export function sliceImpedance(line: RouteCoefficients, i: number): number {
  return Math.sqrt(line.L[i][i] / line.C[i][i])
}

/** A three-stop scale (sky, lime, orange) from the lowest to the highest impedance on the board. */
export function impedanceColor({
  impedance,
  low,
  high,
}: {
  impedance: number
  low: number
  high: number
}): string {
  if (!(high > low)) return impedanceColorAt(0.5)
  return impedanceColorAt(
    Math.min(1, Math.max(0, (impedance - low) / (high - low))),
  )
}

/** Sample the display gradient directly so scale swatches round consistently. */
function impedanceColorAt(t: number): string {
  const stops = [
    [56, 189, 248],
    [163, 230, 53],
    [251, 146, 60],
  ]
  let start = 1
  let u = t * 2 - 1
  if (t < 0.5) {
    start = 0
    u = t * 2
  }
  const a = stops[start]
  const b = stops[start + 1]
  return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * u)).join(", ")})`
}

/** Convert route coordinates to the points used by drawing primitives. */
function drawingPoint([x, y]: RouteXY): Point {
  return { x, y }
}

/** Draw the copper picked by the scope, or every wire when there is no scope. */
function drawCopper({
  drawing,
  geometry,
  circuitJson,
  view,
}: {
  drawing: GraphicsObject
  geometry: SectionGeometry
  circuitJson?: CircuitJson
  view?: RouteView
}): void {
  if (view && circuitJson) {
    routeNets({
      drawing,
      circuit: circuitJson,
      view,
      traceIds: view.traces,
      color: () => routeTones.copper,
    })
    return
  }
  for (const wire of geometry.wires)
    drawing.lines!.push(
      ...routeStroke({
        points: [wire.a, wire.b].map(drawingPoint),
        color: routeTones.copper,
        width: wire.width,
        layer: wire.layer,
      }),
    )
}

export interface FieldsState {
  geometry: SectionGeometry
  circuitJson?: CircuitJson
  scope?: CopperScope
  materials: RouteMaterials
  solved: ExtractedRouteSlice[]
  /** The slice on screen and its cross-section; when solving has finished, the most informative selected slice. */
  slice?: RouteSlice
  section?: CrossSection
  line?: RouteCoefficients
  error?: string
}

/**
 * The selected copper coloured by solved Z0, an amber cut at the slice on screen, and its to-scale stack in
 * the pane.
 */
export function fieldsDrawing(state: FieldsState): GraphicsObject {
  const { geometry, circuitJson, scope } = state
  let view: RouteView | undefined
  if (circuitJson && scope) view = routeView(circuitJson, scope)
  const frame =
    view ??
    routeFrame(
      routeBounds(
        geometry.wires.flatMap((wire) => [wire.a, wire.b].map(drawingPoint)),
      ) ?? {
        minX: 0,
        maxX: 1,
        minY: 0,
        maxY: 1,
      },
    )
  const drawing = routeCanvas(frame)
  drawCopper({
    drawing,
    geometry,
    circuitJson,
    view,
  })
  const impedances = state.solved.flatMap((slice) =>
    slice.wires.flatMap((wire, i) => {
      if (view && !view.traces.has(wire.trace)) return []
      return [sliceImpedance(slice.line, i)]
    }),
  )
  // Never stretch a few ohms across the whole scale: it always spans at least ±10 % of the median.
  const median =
    [...impedances].sort((a, b) => a - b)[Math.floor(impedances.length / 2)] ??
    50
  const low = Math.min(...impedances, median * 0.9)
  const high = Math.max(...impedances, median * 1.1)
  for (const slice of state.solved)
    for (const [i, wire] of slice.wires.entries()) {
      if (view && !view.traces.has(wire.trace)) continue
      const z0 = sliceImpedance(slice.line, i)
      const points = [slice.start, slice.end].map((position) =>
        drawingPoint(routePosition(wire, position)),
      )
      drawing.lines!.push(
        ...routeStroke({
          points,
          color: impedanceColor({ impedance: z0, low, high }),
          width: wire.width,
          layer: wire.layer,
          label: `${z0.toFixed(0)} Ω`,
        }),
      )
    }
  let edge: string | undefined
  if (state.error) edge = routeTones.failure
  routePane({ drawing, box: frame.pane, edge })
  drawSlice({
    drawing,
    state,
    frame,
    view,
    low,
    high,
  })
  if (impedances.length)
    impedanceBar({
      drawing,
      pane: frame.pane,
      low,
      high,
    })
  if (state.error)
    routeFailure({ drawing, box: frame.pane, message: state.error })
  return drawing
}

/** Link the selected cut to its cross-section pane, sharing the board's impedance scale. */
function drawSlice({
  drawing,
  state,
  frame,
  view,
  low,
  high,
}: {
  drawing: GraphicsObject
  state: FieldsState
  frame: RouteFrame
  view?: RouteView
  low: number
  high: number
}): void {
  const { slice, section, line, materials } = state
  if (!slice || !section) return
  const cut = routeBounds(sliceCut({ drawing, slice, unit: frame.unit }))!
  const from = { x: (cut.minX + cut.maxX) / 2, y: (cut.minY + cut.maxY) / 2 }
  let to = { x: from.x, y: frame.pane.maxY }
  if (frame.pane.minX > frame.focus.maxX) to = { x: frame.pane.minX, y: from.y }
  drawing.lines!.push({
    points: [from, to],
    strokeColor: routeTones.slice,
    strokeWidth: frame.unit * 0.18,
    strokeDash: "6 4",
  })
  const conductorDisplay = slice.wires.map((wire, i) => {
    if (view && !view.traces.has(wire.trace)) return { color: "#56606b" }
    if (!line)
      return {
        color: view?.sources.get(wire.source)?.color ?? routeTones.copper,
      }
    const z0 = sliceImpedance(line, i)
    return {
      color: impedanceColor({
        impedance: z0,
        low: Math.min(low, z0),
        high: Math.max(high, z0),
      }),
      label: `${z0.toFixed(0)} Ω`,
    }
  })
  stackPane({
    drawing,
    pane: frame.pane,
    section,
    conductorDisplay,
    line,
    materials,
  })
}

/**
 * An amber band across the slice's conductors at its midpoint, at least a few camera units long so it reads at
 * any zoom.
 */
function sliceCut({
  drawing,
  slice,
  unit,
}: {
  drawing: GraphicsObject
  slice: RouteSlice
  unit: number
}): Point[] {
  const middle = (slice.start + slice.end) / 2
  const reach = Math.max(...slice.wires.map((wire) => wire.width), unit * 1.2)
  const half = unit * 0.35
  const low = Math.min(...slice.wires.map((wire) => wire.transverse)) - reach
  const high = Math.max(...slice.wires.map((wire) => wire.transverse)) + reach
  const points = [
    [-half, low],
    [half, low],
    [half, high],
    [-half, high],
  ].map(([offset, transverse]) =>
    drawingPoint(
      routePosition(
        {
          ...slice.wires[0],
          transverse,
        },
        middle + offset,
      ),
    ),
  )
  drawing.polygons!.push({
    points,
    fill: routeTones.slice,
    stroke: routeTones.halo,
    strokeWidth: unit * 0.08,
  })
  return points
}

/** One stack axis in pane coordinates, using the common millimetre scale. */
function paneCoordinate(
  mm: number,
  {
    center,
    origin,
    scale,
  }: {
    center: number
    origin: number
    scale: number
  },
): number {
  return center + (mm - origin) * scale
}

/** One edge of a coupling band, offset from its center arc. */
function bandArc({
  from,
  to,
  top,
  rise,
  offset,
}: {
  from: number
  to: number
  top: number
  rise: number
  offset: number
}): Point[] {
  return Array.from(
    {
      length: 17,
    },
    (_, t) => ({
      x: from + ((to - from) * t) / 16,
      y: top + (rise + offset) * Math.sin((Math.PI * t) / 16),
    }),
  )
}

/**
 * The cross-section at one uniform mm scale: laminate tan, mask green, planes copper, conductors coloured,
 * coupling bands over the top.
 */
function stackPane({
  drawing,
  pane,
  section,
  conductorDisplay,
  line,
  materials,
}: {
  drawing: GraphicsObject
  pane: Viewbox
  section: CrossSection
  conductorDisplay: {
    color: string
    label?: string
  }[]
  line?: RouteCoefficients
  materials: RouteMaterials
}): void {
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const inner = {
    minX: pane.minX + unit * 5,
    maxX: pane.maxX - unit * 5,
    minY: pane.minY + unit * 13,
    maxY: pane.maxY - unit * 11,
  }
  const zLow = Math.min(
    ...section.dielectrics.map((d) => d.zMm),
    ...section.planes.map((p) => p.zMm),
  )
  const zHigh = Math.max(
    ...section.dielectrics.map((d) => d.zMm + d.thicknessMm),
    ...section.conductors.map((c) => c.zMm + c.thicknessMm),
    ...section.planes.map((p) => p.zMm),
  )
  const low = Math.min(...section.conductors.map((c) => c.xMm - c.widthMm / 2))
  const high = Math.max(...section.conductors.map((c) => c.xMm + c.widthMm / 2))
  const margin = Math.max(zHigh - zLow, (high - low) * 0.3)
  const scale = Math.min(
    (inner.maxX - inner.minX) / (high - low + 2 * margin),
    (inner.maxY - inner.minY) / Math.max(zHigh - zLow, 1e-3),
  )
  const center = {
    x: (inner.minX + inner.maxX) / 2,
    y: (inner.minY + inner.maxY) / 2,
  }
  const transverseToPane = { center: center.x, origin: (low + high) / 2, scale }
  const heightToPane = { center: center.y, origin: (zLow + zHigh) / 2, scale }
  // Reference planes are infinite: the slabs run the full pane width.
  const width = inner.maxX - inner.minX
  for (const [i, slab] of [...section.dielectrics]
    .sort((a, b) => a.zMm - b.zMm)
    .entries()) {
    const mask =
      slab.er === materials.maskEr && slab.lossTangent === materials.maskLoss
    let color = ["#53442f", "#5e4d36"][i % 2]
    if (mask) color = "#24573f"
    drawing.rects!.push({
      center: {
        x: center.x,
        y: paneCoordinate(slab.zMm + slab.thicknessMm / 2, heightToPane),
      },
      width,
      height: slab.thicknessMm * scale,
      fill: color,
    })
  }
  const copper =
    Math.max(section.conductors[0]?.thicknessMm ?? 0.035, 1e-3) * scale
  for (const plane of section.planes)
    drawing.rects!.push({
      center: { x: center.x, y: paneCoordinate(plane.zMm, heightToPane) },
      width,
      height: Math.max(copper, unit * 0.3),
      fill: "#b08d57",
    })
  for (const [i, c] of section.conductors.entries()) {
    const color = conductorDisplay[i]?.color
    drawing.rects!.push({
      center: {
        x: paneCoordinate(c.xMm, transverseToPane),
        y: paneCoordinate(c.zMm + c.thicknessMm / 2, heightToPane),
      },
      width: Math.max(c.widthMm * scale, unit * 0.3),
      height: Math.max(c.thicknessMm * scale, unit * 0.3),
      fill: color,
      stroke: color,
    })
  }
  if (!line) return
  const top = paneCoordinate(zHigh, heightToPane) + unit
  const pairs = section.conductors
    .flatMap((a, i) =>
      section.conductors.slice(i + 1).map((b, offset) => {
        const j = i + offset + 1
        return {
          a,
          b,
          k: Math.max(
            Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]),
            Math.abs(line.L[i][j]) / Math.sqrt(line.L[i][i] * line.L[j][j]),
          ),
        }
      }),
    )
    .filter((pair) => pair.k >= 0.005)
    .sort((p, q) => q.k - p.k)
  for (const pair of routeDisplayItems(pairs, 60)) {
    const [from, to] = [pair.a.xMm, pair.b.xMm]
      .map((mm) => paneCoordinate(mm, transverseToPane))
      .sort((p, q) => p - q)
    const rise = Math.min(unit * 8, (to - from) * 0.4) + unit
    const thickness = unit * (0.3 + 3 * Math.sqrt(Math.min(pair.k, 1)))
    const upper = bandArc({
      from,
      to,
      top,
      rise,
      offset: thickness / 2,
    })
    const lower = bandArc({
      from,
      to,
      top,
      rise,
      offset: -thickness / 2,
    })
    drawing.polygons!.push({
      points: [...upper, ...lower.reverse()],
      fill: routeTones.coupling,
      stroke: "none",
      label: `k ${pair.k.toFixed(3)}`,
    })
  }
  const labelled = section.conductors.flatMap((c, i) => {
    const display = conductorDisplay[i]
    if (!display?.label) return []
    return [
      {
        x: paneCoordinate(c.xMm, transverseToPane),
        text: display.label,
        color: display.color,
      },
    ]
  })
  if (labelled.length > 8) return
  // Neighbouring labels closer than a label's width alternate between two rows.
  const crowded = labelled.some(
    (entry, i) =>
      i > 0 &&
      Math.abs(entry.x - labelled[i - 1].x) <
        unit * 2.8 * 0.6 * entry.text.length,
  )
  for (const [i, entry] of labelled.entries()) {
    let row = 3.5
    if (crowded && i % 2) row = 7
    routeText({
      drawing,
      x: entry.x,
      y: paneCoordinate(zLow, heightToPane) - unit * row,
      text: entry.text,
      color: entry.color,
      size: unit * 2.8,
    })
  }
}

/** The impedance scale at the pane's foot: a gradient strip between the lowest and highest Z0. */
function impedanceBar({
  drawing,
  pane,
  low,
  high,
}: {
  drawing: GraphicsObject
  pane: Viewbox
  low: number
  high: number
}): void {
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const left = pane.minX + (pane.maxX - pane.minX) * 0.3
  const right = pane.maxX - (pane.maxX - pane.minX) * 0.3
  const y = pane.minY + unit * 2.5
  for (let i = 0; i < 24; i++)
    drawing.rects!.push({
      center: { x: left + ((right - left) * (i + 0.5)) / 24, y },
      width: (right - left) / 24,
      height: unit * 1.2,
      fill: impedanceColorAt((i + 0.5) / 24),
    })
  routeText({
    drawing,
    x: left - unit,
    y,
    text: `${low.toFixed(0)} Ω`,
    color: routeTones.quiet,
    size: unit * 2.6,
    anchor: "center_right",
  })
  routeText({
    drawing,
    x: right + unit,
    y,
    text: `${high.toFixed(0)} Ω`,
    color: routeTones.quiet,
    size: unit * 2.6,
    anchor: "center_left",
  })
}
