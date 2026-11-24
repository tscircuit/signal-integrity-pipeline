import type { GraphicsObject, Point, Viewbox } from "graphics-debug"
import {
  type CircuitJson,
  type CopperPoint,
  type CopperScope,
  type ExtractedCopper,
  getPointBounds,
  getWirePoint,
  type RouteFrame,
  type RouteView,
  routeCanvas,
  routeDisplayItems,
  routeFailure,
  routeFrame,
  routeNets,
  routePane,
  routeStroke,
  routeText,
  routeTones,
  routeView,
  type WireSection,
  withRouteDrawing,
} from "../board"
import type { Snapshot } from "../kernel"
import type { CrossSection, RlgcMatrices } from "./cross-section"
import type { DielectricMaterials } from "./dielectric-materials"
import type { SolvedWireSection } from "./transmission-line-rlgc-types"

/** Characteristic impedance of conductor `i` from its self terms. */
function calculateImpedanceOhms({
  line,
  i,
}: {
  line: Snapshot<RlgcMatrices>
  i: number
}): number {
  return Math.sqrt(
    line.externalInductanceHenriesPerMeter[i][i] /
      line.capacitanceFaradsPerMeter[i][i],
  )
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

/** Keep the impedance legend and strip on the same sky, lime and orange scale. */
const IMPEDANCE_COLOR_STOPS = [
  [56, 189, 248],
  [163, 230, 53],
  [251, 146, 60],
]

/** Sample the display gradient directly so scale swatches round consistently. */
function impedanceColorAt(t: number): string {
  const stops = IMPEDANCE_COLOR_STOPS
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
function drawingPoint([x, y]: Snapshot<CopperPoint>): Point {
  return { x, y }
}

/** Draw the copper picked by the scope, or every wire when there is no scope. */
function drawCopper({
  geometry,
  circuitJson,
  view,
}: {
  geometry: Snapshot<ExtractedCopper>
  circuitJson?: CircuitJson
  view?: RouteView
}): NonNullable<GraphicsObject["lines"]> {
  const drawing = routeCanvas()
  if (view && circuitJson) {
    drawing.lines!.push(
      ...routeNets({
        circuit: circuitJson,
        view,
        traceIds: view.traces,
        color: () => routeTones.copper,
      }),
    )
    return drawing.lines!
  }
  for (const wire of geometry.wires)
    drawing.lines!.push(
      ...routeStroke({
        points: [wire.startPoint, wire.endPoint].map(drawingPoint),
        color: routeTones.copper,
        width: wire.widthMm,
        layer: wire.layer,
      }),
    )
  return drawing.lines!
}

export interface TransmissionLineRlgcDrawing {
  geometry: Snapshot<ExtractedCopper>
  circuitJson?: CircuitJson
  scope?: Snapshot<CopperScope>
  materials: DielectricMaterials
  solved: SolvedWireSection[]
  /** The slice on screen and its cross-section; when solving has finished, the most informative selected slice. */
  slice?: Snapshot<WireSection>
  section?: CrossSection
  line?: Snapshot<RlgcMatrices>
  error?: string
}

/**
 * The selected copper coloured by solved Z0, an amber cut at the slice on screen, and its to-scale stack in
 * the pane.
 */
export function drawTransmissionLineRlgc(
  state: TransmissionLineRlgcDrawing,
): GraphicsObject {
  const { geometry, circuitJson, scope } = state
  let view: RouteView | undefined
  if (circuitJson && scope) view = routeView({ circuit: circuitJson, scope })
  const frame =
    view ??
    routeFrame(
      getPointBounds(
        geometry.wires.flatMap((wire) =>
          [wire.startPoint, wire.endPoint].map(drawingPoint),
        ),
      ) ?? {
        minX: 0,
        maxX: 1,
        minY: 0,
        maxY: 1,
      },
    )
  let drawing = routeCanvas(frame)
  drawing.lines!.push(
    ...drawCopper({
      geometry,
      circuitJson,
      view,
    }),
  )
  const impedances = state.solved.flatMap((slice) =>
    slice.wires.flatMap((wire, i) => {
      if (view && !view.traces.has(wire.pcbTraceId)) return []
      return [calculateImpedanceOhms({ line: slice.rlgcMatrices, i })]
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
      if (view && !view.traces.has(wire.pcbTraceId)) continue
      const z0 = calculateImpedanceOhms({ line: slice.rlgcMatrices, i })
      const points = [slice.startMm, slice.endMm].map((position) =>
        drawingPoint(getWirePoint({ wire, positionMm: position })),
      )
      drawing.lines!.push(
        ...routeStroke({
          points,
          color: impedanceColor({ impedance: z0, low, high }),
          width: wire.widthMm,
          layer: wire.layer,
          label: `${z0.toFixed(0)} Ω`,
        }),
      )
    }
  let edge: string | undefined
  if (state.error) edge = routeTones.failure
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: routePane({ box: frame.pane, edge }),
  })
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: drawSlice({
      state,
      frame,
      view,
      low,
      high,
    }),
  })
  if (impedances.length)
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: impedanceBar({
        pane: frame.pane,
        low,
        high,
      }),
    })
  if (state.error)
    drawing.texts!.push(
      ...routeFailure({ box: frame.pane, message: state.error }),
    )
  return drawing
}

/** Link the selected cut to its cross-section pane, sharing the board's impedance scale. */
function drawSlice({
  state,
  frame,
  view,
  low,
  high,
}: {
  state: TransmissionLineRlgcDrawing
  frame: RouteFrame
  view?: RouteView
  low: number
  high: number
}): GraphicsObject {
  let drawing = routeCanvas()
  const { slice, section, line, materials } = state
  if (!slice || !section) return drawing
  const marker = sliceCut({ slice, unit: frame.unit })
  drawing.polygons!.push(marker)
  const cut = getPointBounds(marker.points)!
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
    if (view && !view.traces.has(wire.pcbTraceId)) return { color: "#56606b" }
    if (!line)
      return {
        color:
          view?.sources.get(wire.sourceTraceId)?.color ?? routeTones.copper,
      }
    const z0 = calculateImpedanceOhms({ line, i })
    return {
      color: impedanceColor({
        impedance: z0,
        low: Math.min(low, z0),
        high: Math.max(high, z0),
      }),
      label: `${z0.toFixed(0)} Ω`,
    }
  })
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: stackPane({
      pane: frame.pane,
      section,
      conductorDisplay,
      line,
      materials,
    }),
  })
  return drawing
}

/** One polygon marking a slice on the board. */
type SliceMarker = NonNullable<GraphicsObject["polygons"]>[number]

/**
 * An amber band across the slice's conductors at its midpoint, at least a few camera units long so it reads at
 * any zoom.
 */
function sliceCut({
  slice,
  unit,
}: {
  slice: Snapshot<WireSection>
  unit: number
}): SliceMarker {
  const middle = (slice.startMm + slice.endMm) / 2
  const reach = Math.max(...slice.wires.map((wire) => wire.widthMm), unit * 1.2)
  const half = unit * 0.35
  const low =
    Math.min(...slice.wires.map((wire) => wire.lateralOffsetMm)) - reach
  const high =
    Math.max(...slice.wires.map((wire) => wire.lateralOffsetMm)) + reach
  const points = [
    [-half, low],
    [half, low],
    [half, high],
    [-half, high],
  ].map(([offset, transverse]) =>
    drawingPoint(
      getWirePoint({
        wire: {
          ...slice.wires[0],
          lateralOffsetMm: transverse,
        },
        positionMm: middle + offset,
      }),
    ),
  )
  return {
    points,
    fill: routeTones.slice,
    stroke: routeTones.halo,
    strokeWidth: unit * 0.08,
  }
}

/** One stack axis in pane coordinates, using the common millimetre scale. */
function paneCoordinate({
  mm,
  axis,
}: {
  mm: number
  axis: {
    center: number
    origin: number
    scale: number
  }
}): number {
  const { center, origin, scale } = axis
  return center + (mm - origin) * scale
}

/** Smooth the coupling arc with equally spaced segments. */
const COUPLING_ARC_SEGMENTS = 16

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
      length: COUPLING_ARC_SEGMENTS + 1,
    },
    (_, t) => ({
      x: from + ((to - from) * t) / COUPLING_ARC_SEGMENTS,
      y:
        top + (rise + offset) * Math.sin((Math.PI * t) / COUPLING_ARC_SEGMENTS),
    }),
  )
}

/**
 * The cross-section at one uniform mm scale: laminate tan, mask green, planes copper, conductors coloured,
 * coupling bands over the top.
 */
function stackPane({
  pane,
  section,
  conductorDisplay,
  line,
  materials,
}: {
  pane: Viewbox
  section: CrossSection
  conductorDisplay: {
    color: string
    label?: string
  }[]
  line?: Snapshot<RlgcMatrices>
  materials: DielectricMaterials
}): GraphicsObject {
  const drawing = routeCanvas()
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const inner = {
    minX: pane.minX + unit * 5,
    maxX: pane.maxX - unit * 5,
    minY: pane.minY + unit * 13,
    maxY: pane.maxY - unit * 11,
  }
  const zLow = Math.min(
    ...section.dielectricLayers.map((d) => d.zMm),
    ...section.planes.map((p) => p.zMm),
  )
  const zHigh = Math.max(
    ...section.dielectricLayers.map((d) => d.zMm + d.thicknessMm),
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
  for (const [i, slab] of [...section.dielectricLayers]
    .sort((a, b) => a.zMm - b.zMm)
    .entries()) {
    const mask =
      slab.relativePermittivity === materials.maskRelativePermittivity &&
      slab.lossTangent === materials.maskLossTangent
    let color = ["#53442f", "#5e4d36"][i % 2]
    if (mask) color = "#24573f"
    drawing.rects!.push({
      center: {
        x: center.x,
        y: paneCoordinate({
          mm: slab.zMm + slab.thicknessMm / 2,
          axis: heightToPane,
        }),
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
      center: {
        x: center.x,
        y: paneCoordinate({ mm: plane.zMm, axis: heightToPane }),
      },
      width,
      height: Math.max(copper, unit * 0.3),
      fill: "#b08d57",
    })
  for (const [i, c] of section.conductors.entries()) {
    const color = conductorDisplay[i]?.color
    drawing.rects!.push({
      center: {
        x: paneCoordinate({ mm: c.xMm, axis: transverseToPane }),
        y: paneCoordinate({
          mm: c.zMm + c.thicknessMm / 2,
          axis: heightToPane,
        }),
      },
      width: Math.max(c.widthMm * scale, unit * 0.3),
      height: Math.max(c.thicknessMm * scale, unit * 0.3),
      fill: color,
      stroke: color,
    })
  }
  if (!line) return drawing
  const top = paneCoordinate({ mm: zHigh, axis: heightToPane }) + unit
  const pairs = section.conductors
    .flatMap((a, i) =>
      section.conductors.slice(i + 1).map((b, offset) => {
        const j = i + offset + 1
        return {
          a,
          b,
          k: Math.max(
            Math.abs(line.capacitanceFaradsPerMeter[i][j]) /
              Math.sqrt(
                line.capacitanceFaradsPerMeter[i][i] *
                  line.capacitanceFaradsPerMeter[j][j],
              ),
            Math.abs(line.externalInductanceHenriesPerMeter[i][j]) /
              Math.sqrt(
                line.externalInductanceHenriesPerMeter[i][i] *
                  line.externalInductanceHenriesPerMeter[j][j],
              ),
          ),
        }
      }),
    )
    .filter((pair) => pair.k >= 0.005)
    .sort((p, q) => q.k - p.k)
  for (const pair of routeDisplayItems({ items: pairs, limit: 60 })) {
    const [from, to] = [pair.a.xMm, pair.b.xMm]
      .map((mm) =>
        paneCoordinate({
          mm,
          axis: transverseToPane,
        }),
      )
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
        x: paneCoordinate({ mm: c.xMm, axis: transverseToPane }),
        text: display.label,
        color: display.color,
      },
    ]
  })
  if (labelled.length > 8) return drawing
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
    drawing.texts!.push(
      routeText({
        x: entry.x,
        y: paneCoordinate({ mm: zLow, axis: heightToPane }) - unit * row,
        text: entry.text,
        color: entry.color,
        size: unit * 2.8,
      }),
    )
  }
  return drawing
}

/** The impedance scale at the pane's foot: a gradient strip between the lowest and highest Z0. */
function impedanceBar({
  pane,
  low,
  high,
}: {
  pane: Viewbox
  low: number
  high: number
}): GraphicsObject {
  const drawing = routeCanvas()
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
  drawing.texts!.push(
    routeText({
      x: left - unit,
      y,
      text: `${low.toFixed(0)} Ω`,
      color: routeTones.quiet,
      size: unit * 2.6,
      anchor: "center_right",
    }),
  )
  drawing.texts!.push(
    routeText({
      x: right + unit,
      y,
      text: `${high.toFixed(0)} Ω`,
      color: routeTones.quiet,
      size: unit * 2.6,
      anchor: "center_left",
    }),
  )
  return drawing
}
