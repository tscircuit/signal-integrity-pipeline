import { cju } from "@tscircuit/circuit-json-util"
import type { GraphicsObject } from "graphics-debug"
import type { Snapshot } from "../kernel"
import { CopperGeometryExtractionSolver as BoardCopperGeometryExtractionSolver } from "./copper-geometry-extraction"
import type { CopperGeometryExtractionInput } from "./copper-geometry-extraction-input"
import { extractTraceWires } from "./copper-geometry-traces"
import type { ExtractedCopper, TraceWire } from "./copper-geometry-types"
import {
  type RouteNet,
  routeCanvas,
  routeFailure,
  routeHue,
  routeNets,
  routeStroke,
  routeTones,
  routeVia,
  routeView,
  withRouteDrawing,
} from "./route-visual"
import {
  type RouteStripRow,
  routeLengths,
  routeStrip,
  routeUnrolled,
} from "./route-visual-strip"
import { type CircuitJson, cloneCircuitJson } from "./schema"

type DrawingGeometry = Snapshot<Pick<ExtractedCopper, "wires" | "vias">>

/** Reconstruct completed steps on demand for the pipeline's animated drawing. */
function getDrawingGeometry({
  solver,
  input,
  circuit,
}: {
  solver: BoardCopperGeometryExtractionSolver
  input: CopperGeometryExtractionInput
  circuit: CircuitJson
}): DrawingGeometry {
  if (solver.solved) return solver.getOutput().value.geometry
  const traceCount = Number(solver.stats.traces) || 0
  const traceIds = new Set(input.copperScope.extractedPcbTraceIds)
  const db = cju(circuit)
  const traces = db.pcb_trace
    .list()
    .filter((trace) => traceIds.has(trace.pcb_trace_id))
    .slice(0, traceCount)
  const wires: TraceWire[] = []
  const vias: ExtractedCopper["vias"] = []
  for (const trace of traces) {
    const extracted = extractTraceWires({
      circuit,
      trace,
      firstWireIndex: wires.length,
    })
    wires.push(...extracted.wires)
    vias.push(...extracted.vias)
  }
  return { wires, vias }
}

type PcbTraceId = TraceWire["pcbTraceId"]
type RouteNetLabel = RouteNet["label"]

/** Alternate light and dark sections of the same net, keeping unassigned copper neutral. */
function sectionColor({
  net,
  index,
}: {
  net: RouteNet | undefined
  index: number
}): string {
  if (!net) return routeTones.copper
  let shift = -6
  if (index % 2) shift = 16
  return routeHue({
    hue: net.hue,
    lightness: Math.min(86, net.lightness + shift),
  })
}

/** Draw route sections in the composed pipeline's shared board and length panes. */
export const CopperGeometryExtractionStage: typeof BoardCopperGeometryExtractionSolver = class CopperGeometryExtractionSolver extends BoardCopperGeometryExtractionSolver {
  /**
   * Sections alternate two tones of their net's hue, the wire processed this step wears a white casing, and unprocessed copper stays neutral grey.
   */
  override visualize(): GraphicsObject {
    const [input] = this.getConstructorParams()
    const circuit = cloneCircuitJson(input.circuitJson)
    const view = routeView({ circuit, scope: input.copperScope })
    const geometry = getDrawingGeometry({ solver: this, input, circuit })
    let drawing = routeCanvas(view)
    const wires = geometry.wires.filter((wire) =>
      view.traces.has(wire.pcbTraceId),
    )
    const done = new Set(wires.map((wire) => wire.pcbTraceId))
    drawing.lines!.push(
      ...routeNets({
        circuit,
        view,
        traceIds: new Set([...view.traces].filter((id) => !done.has(id))),
        color: () => routeTones.copper,
      }),
    )
    let active: PcbTraceId | undefined
    if (!this.solved) active = wires.at(-1)?.pcbTraceId
    const tone = new Map<PcbTraceId | RouteNetLabel, number>()
    for (const wire of wires) {
      const net = view.sources.get(wire.sourceTraceId)
      const index = (tone.get(wire.pcbTraceId) ?? -1) + 1
      tone.set(wire.pcbTraceId, index)
      const points = [wire.startPoint, wire.endPoint].map(([x, y]) => ({
        x,
        y,
      }))
      if (wire.pcbTraceId === active)
        drawing.lines!.push({
          points,
          strokeColor: routeTones.via,
          strokeWidth: wire.widthMm * 2.2,
        })
      drawing.lines!.push(
        ...routeStroke({
          points,
          color: sectionColor({ net, index }),
          width: wire.widthMm,
          layer: wire.layer,
          label: net?.label,
        }),
      )
    }
    // The pane unrolls each net: its sections in the same two tones and leaves unprocessed copper grey.
    const unrolled = routeUnrolled({ view, wires })
    const rows = new Map<RouteNetLabel, RouteStripRow>(
      routeLengths({ circuit, view }).map((row) => [
        row.net.label,
        {
          ...row,
          parts: [],
        },
      ]),
    )
    tone.clear()
    for (const wire of wires) {
      const at = unrolled.along({
        id: wire.wireIndex,
        position: wire.longitudinalMinMm,
      })
      if (!at) continue
      const row = rows.get(at.net.label)
      if (!row) continue
      const index = (tone.get(at.net.label) ?? -1) + 1
      tone.set(at.net.label, index)
      row.parts!.push({
        from: at.distance,
        to: at.distance + wire.longitudinalMaxMm - wire.longitudinalMinMm,
        color: sectionColor({ net: at.net, index }),
        casing: wire.pcbTraceId === active,
      })
    }
    for (const row of rows.values()) {
      const cut = row.parts!.at(-1)?.to ?? 0
      row.length = Math.max(row.length, cut)
      if (cut < row.length)
        row.parts!.push({ from: cut, to: row.length, color: routeTones.copper })
    }
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: routeStrip({ pane: view.pane, rows: [...rows.values()] }),
    })
    let width = view.unit
    if (wires.length)
      width = wires.reduce((sum, wire) => sum + wire.widthMm, 0) / wires.length
    for (const contact of geometry.vias)
      if (
        contact.pcbTraceId !== undefined &&
        view.traces.has(contact.pcbTraceId)
      )
        drawing.polygons!.push(
          ...routeVia({
            center: { x: contact.point[0], y: contact.point[1] },
            radius: width * 1.4,
          }),
        )
    if (this.failed)
      drawing.texts!.push(
        ...routeFailure({
          box: view.pane,
          message: this.error ?? "Rejected endpoint",
        }),
      )
    return drawing
  }
}
