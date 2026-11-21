import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { type Produced, rootScope, snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import {
  type RouteWire,
  routeContactFrame,
  routeSectionSteps,
  type SectionGeometry,
} from "./route-sections"
import {
  type RouteNet,
  type RouteStripRow,
  routeCanvas,
  routeFailure,
  routeHue,
  routeLengths,
  routeNets,
  routeStrip,
  routeStroke,
  routeTones,
  routeUnrolled,
  routeVia,
  routeView,
} from "./route-visual"
import type { CircuitJson } from "./schema"

/** The board, selected copper and required ports passed to route sectioning. */
export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: SourcePortId[]
  artifactPrefix: string
}
/** Completed route geometry and its outer soldermask thickness when declared. */
export interface RoutedSections {
  circuitJson: CircuitJson
  scope: CopperScope
  geometry: SectionGeometry
  maskThicknessMm: number | null
}

type PcbTraceId = RouteWire["trace"]
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

/** Segment one real route per step, then admit selected endpoint contacts. */
export class RouteSectionsSolver extends BaseSolver {
  private steps?: Generator<SectionGeometry, SectionGeometry>
  private geometry?: SectionGeometry
  private output?: Produced<RoutedSections>
  /** Capture the board and its prepared copper scope. */
  constructor(private readonly input: RouteSectionsInput) {
    super()
  }
  /** Each yield has performed one route's segmentation; the final pass slices actual references. */
  override _step(): void {
    this.steps ??= routeSectionSteps({
      circuit: this.input.circuitJson,
      scope: this.input.scope,
    })
    const result = this.steps.next()
    const geometry = result.value
    this.geometry = geometry
    this.stats = {
      routes: Math.min(this.iterations, this.input.scope.pcbTraceIds.length),
      wires: geometry.wires.length,
      slices: geometry.slices.length,
    }
    if (!result.done) return

    const { circuitJson, requiredSourcePortIds, artifactPrefix } = this.input
    const [stackup] = circuitJson.filter(
      (record) => record.type === "pcb_stackup",
    )
    const masks = stackup.layers.filter(
      (layer) => layer.layer_type === "soldermask",
    )
    if (new Set(masks.map((layer) => layer.thickness)).size > 1) {
      throw new Error(
        "Asymmetric soldermask thickness requires separate outer-layer material profiles",
      )
    }
    for (const id of requiredSourcePortIds) {
      const port = circuitJson.find(
        (record) => record.type === "pcb_port" && record.source_port_id === id,
      )
      if (
        port?.type === "pcb_port" &&
        port.layers.some((layer) =>
          routeContactFrame({
            geometry,
            scope: this.input.scope,
            layer,
            point: [port.x, port.y],
          }),
        )
      )
        continue
      throw new Error(
        `selected endpoint ${id} has no physical wire or via contact`,
      )
    }

    const value = snapshot<RoutedSections>({
      circuitJson,
      scope: this.input.scope,
      geometry,
      maskThicknessMm: masks[0]?.thickness ?? null,
    })
    const scope = rootScope("board").child(artifactPrefix)
    this.output = {
      value,
      artifacts: [
        scope.json("geometry.json", value.geometry),
        scope.json("scope.json", value.scope),
      ],
    }
    this.solved = true
  }
  /** Completed immutable geometry only. */
  override getOutput(): Produced<RoutedSections> {
    if (!this.output) throw new Error("Route sections are incomplete")
    return this.output
  }
  /** Original problem, independent of work state. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteSectionsSolver
  > {
    return [this.input]
  }

  /**
   * Sections alternate two tones of their net's hue, the route cut this step wears a white casing, and copper
   * not yet cut stays neutral grey.
   */
  override visualize(): GraphicsObject {
    const circuit = this.input.circuitJson
    const view = routeView({ circuit, scope: this.input.scope })
    const drawing = routeCanvas(view)
    const wires = (this.geometry?.wires ?? []).filter((wire) =>
      view.traces.has(wire.trace),
    )
    const done = new Set(wires.map((wire) => wire.trace))
    routeNets({
      drawing,
      circuit,
      view,
      traceIds: new Set([...view.traces].filter((id) => !done.has(id))),
      color: () => routeTones.copper,
    })
    let active: PcbTraceId | undefined
    if (!this.solved) active = wires.at(-1)?.trace
    const tone = new Map<PcbTraceId | RouteNetLabel, number>()
    for (const wire of wires) {
      const net = view.sources.get(wire.source)
      const index = (tone.get(wire.trace) ?? -1) + 1
      tone.set(wire.trace, index)
      const points = [wire.a, wire.b].map(([x, y]) => ({ x, y }))
      if (wire.trace === active)
        drawing.lines!.push({
          points,
          strokeColor: routeTones.via,
          strokeWidth: wire.width * 2.2,
        })
      drawing.lines!.push(
        ...routeStroke({
          points,
          color: sectionColor({ net, index }),
          width: wire.width,
          layer: wire.layer,
          label: net?.label,
        }),
      )
    }
    // The pane unrolls each net: its sections in the same two tones, uncut copper grey.
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
      const at = unrolled.along({ id: wire.id, position: wire.start })
      if (!at) continue
      const row = rows.get(at.net.label)
      if (!row) continue
      const index = (tone.get(at.net.label) ?? -1) + 1
      tone.set(at.net.label, index)
      row.parts!.push({
        from: at.distance,
        to: at.distance + wire.end - wire.start,
        color: sectionColor({ net: at.net, index }),
        casing: wire.trace === active,
      })
    }
    for (const row of rows.values()) {
      const cut = row.parts!.at(-1)?.to ?? 0
      row.length = Math.max(row.length, cut)
      if (cut < row.length)
        row.parts!.push({ from: cut, to: row.length, color: routeTones.copper })
    }
    routeStrip({ drawing, pane: view.pane, rows: [...rows.values()] })
    let width = view.unit
    if (wires.length)
      width = wires.reduce((sum, wire) => sum + wire.width, 0) / wires.length
    for (const contact of this.geometry?.viaContacts ?? [])
      if (view.traces.has(contact.trace))
        routeVia({
          drawing,
          center: { x: contact.point[0], y: contact.point[1] },
          radius: width * 1.4,
        })
    if (this.failed)
      routeFailure({
        drawing,
        box: view.pane,
        message: this.error ?? "Rejected endpoint",
      })
    return drawing
  }
}
