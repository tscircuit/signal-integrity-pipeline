/* eslint-disable local/max-file-lines -- Stage drawings use the same intermediate state as network compilation. */
import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type CopperPoint,
  cloneCircuitJson,
  findPadContactWire,
  getSourcePortConnectivityMapFromCircuitJson,
  getWirePoint,
  type Point,
  type RouteStripRow,
  routeBoardDrawing,
  routeDisplayItems,
  routeFailure,
  routeLengths,
  routeStrip,
  routeTones,
  routeUnrolled,
  routeVia,
  routeView,
  type SourcePortId,
  sourceNetMembers,
  type TraceWire,
  withRouteDrawing,
} from "../board"
import {
  type Produced,
  rootScope,
  type Snapshot,
  sha256,
  snapshot,
} from "../kernel"
import { branchSaves } from "./branch-saves"
import { namespaceSpice } from "./netlist"
import type { RoutedDeck, RouteNetworkInput } from "./route-inputs"
import {
  type RouteContactKey,
  type RouteLadder,
  routeContactKey,
  routeLadderSteps,
} from "./route-ladder"
import { routeOblique } from "./route-oblique"
import { routedRequest } from "./route-transient"
import { routeTransitions } from "./route-transitions"
import { routedControl } from "./routed-control"
import { spiceSubcircuitHeader, spiceWords } from "./spice-header"
import { findClosestWirePoints } from "./wire-proximity"

/** Small series resistance joins aliases without creating an ideal-voltage loop (ohms). */
const JOIN_RESISTANCE = "1e-6"
/** Weak DC anchor for otherwise floating neighbouring copper (ohms). */
const BIAS_RESISTANCE = "1e9"
/** Default SPICE current convergence tolerance (amperes). */
const DEFAULT_CURRENT_TOLERANCE = 1e-9
/** Relative convergence tolerance for transient voltages and currents. */
const RELATIVE_TOLERANCE = "1e-4"
/** Absolute voltage convergence tolerance in volts. */
const VOLTAGE_TOLERANCE = "1e-6"
/** Restrict Gear integration to second order. */
const GEAR_MAX_ORDER = 2
/** Relative pivot threshold used by ngspice during sparse elimination. */
const PIVOT_TOLERANCE = "0.1"

/** Omit coupling bands below 1% so weak interactions do not crowd the drawing. */
const MINIMUM_DRAWN_COUPLING = 0.01

/** Physical node identity, coupled ladders, corrections and the single deck assembly. */
export class RouteNetworkSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private steps?: Generator<void, Produced<RoutedDeck>>
  private output?: Produced<RoutedDeck>
  private ladder?: RouteLadder
  private obliqueRecords: ReturnType<typeof routeOblique>["records"] = []
  /** Completed geometry, fields and bindings are immutable input snapshots. */
  constructor(private readonly input: RouteNetworkInput) {
    super()
  }
  /** Build one route run; the last step assembles the coupled energies and deck. */
  override _step(): void {
    this.steps ??= this.build()
    const result = this.steps.next()
    this.stats = {
      routeRuns: this.iterations,
      cells: this.ladder?.cells ?? 0,
      maximumCellDelaySeconds: this.ladder?.maximumDelaySeconds ?? 0,
    }
    if (!result.done) return
    this.output = result.value
    this.solved = true
  }
  /** Preserve the original compiler's exact node and SPICE ordering. */
  private *build(): Generator<void, Produced<RoutedDeck>> {
    const { geometry, extracted, bindings, options, materials } = this.input
    const { scope, models, receiverPaths } = bindings
    const probes = [...bindings.plan.probes]
    const db = cju(cloneCircuitJson(bindings.circuitJson))
    const ports = db.pcb_port.list()
    const aliases: string[] = []
    const known = new Map<RouteContactKey, string>()
    for (const port of ports) {
      for (const layer of port.layers) {
        const point: CopperPoint = [port.x, port.y]
        if (
          !findPadContactWire({
            geometry,
            pcbPortId: port.pcb_port_id,
            layer,
            point,
          })
        )
          continue
        const id = routeContactKey({ layer, point })
        const portNode = routedNode({
          nodeMap: bindings.nodeMap,
          id: port.source_port_id,
        })
        const previous = known.get(id)
        if (previous && previous !== portNode) {
          aliases.push(
            `RALIAS${aliases.length} ${previous} ${portNode} ${JOIN_RESISTANCE}`,
          )
          continue
        }
        known.set(id, portNode)
      }
    }
    const endpoint = createRouteEndpoint({ scope, known })
    for (const wire of geometry.wires) {
      for (const join of wire.joins ?? []) {
        const from = endpoint({ wire, point: join.fromPoint })
        const to = endpoint({ wire, point: join.toPoint })
        if (from !== to)
          aliases.push(
            `RJOIN${aliases.length} ${from} ${to} ${JOIN_RESISTANCE}`,
          )
      }
    }
    const steps = routeLadderSteps({
      extracted,
      endpoint,
      riseSeconds: options.fastestEdgeSeconds,
      refinement: options.refinement,
      cellsPerRise: options.cellsPerRise,
    })
    let result = steps.next()
    while (!result.done) {
      this.ladder = result.value
      yield
      result = steps.next()
    }
    const ladder = result.value
    this.ladder = ladder
    const oblique = routeOblique({
      geometry,
      extracted,
      ladder,
      scope,
      materials,
      panels: options.panels,
    })
    const transitions = routeTransitions({
      circuit: bindings.circuitJson,
      scope,
      geometry,
      endpoint,
      groundPort: bindings.groundSourcePortId,
    })
    const currentTolerance =
      options.currentToleranceA ?? DEFAULT_CURRENT_TOLERANCE
    const convergence = `klu reltol=${RELATIVE_TOLERANCE} abstol=${currentTolerance} vntol=${VOLTAGE_TOLERANCE}`
    const integration = `method=gear maxord=${GEAR_MAX_ORDER} pivrel=${PIVOT_TOLERANCE}`
    const lines = [
      "Routed quasi-TEM coupled 2D extraction; JLC standard stackup (assumed)",
      `.options ${convergence} ${integration}`,
      ...bindings.electricalLines,
    ]
    const saved: string[] = []
    for (const [i, model] of models.entries()) {
      const namespaced = namespaceSpice({
        source: model.source,
        prefix: `I${i}`,
      })
      const header = spiceSubcircuitHeader(model.source)!
      const nodes = spiceWords(header[1]).map((terminal) => {
        return routedNode({
          nodeMap: bindings.nodeMap,
          id: model.spicePinMapping[terminal],
        })
      })
      saved.push(
        ...branchSaves({
          source: namespaced.source,
          instance: `XIBIS${i}`,
          wrapper: namespaced.wrapper,
        }),
      )
      lines.push(
        namespaced.source,
        `XIBIS${i} ${nodes.join(" ")} ${namespaced.wrapper}`,
      )
    }
    for (const collection of [
      aliases,
      ladder.lines,
      oblique.lines,
      transitions.lines,
    ]) {
      for (const line of collection) lines.push(line)
    }
    const routeNodes = [...ladder.wireNodes.values()].flatMap((records) =>
      records.map((record) => record.node),
    )
    const modelNodes = models.flatMap((model) => {
      return Object.values(model.spicePinMapping).map((port) =>
        routedNode({ nodeMap: bindings.nodeMap, id: port }),
      )
    })
    const biasNodes = [...new Set([...routeNodes, ...modelNodes])].filter(
      (node) => node !== "0",
    )
    for (const [i, node] of biasNodes.entries())
      lines.push(`RBIAS${i} ${node} 0 ${BIAS_RESISTANCE}`)
    for (const probe of probes.filter((probe) => probe.referenceNode !== "0")) {
      const terminals = [
        ["P", probe.signalNode, probe.signalSourceId],
        ["N", probe.referenceNode, probe.referenceSourceId],
      ] as const
      for (const [suffix, signalNode, signalSourceId] of terminals) {
        probes.push({
          ...probe,
          name: `${probe.name}_${suffix}`,
          simulationVoltageProbeId: `${probe.simulationVoltageProbeId}_${suffix}`,
          column: probes.length + 1,
          signalNode,
          signalSourceId: signalSourceId!,
          referenceNode: "0",
          referenceSourceId: bindings.groundSourcePortId,
        })
      }
    }
    // Only save receiver nodes and behavioural-source branch dependencies; the engine exposes the resulting vectors.
    const probeNodes = probes.flatMap((probe) => [
      probe.signalNode,
      probe.referenceNode,
    ])
    const savedNodes = probeNodes.filter((node) => node !== "0")
    const voltageSaves = [...new Set(savedNodes)].map((node) => `v(${node})`)
    const save = [...voltageSaves, ...saved].join(" ")
    lines.push(
      ...routedControl({
        saved: save,
        stepSeconds: options.stepSeconds,
        durationSeconds: options.durationSeconds,
      }),
    )
    const connectivity = getSourcePortConnectivityMapFromCircuitJson(
      db.toArray(),
    )
    const ground = sourceNetMembers({
      connectivity,
      memberId: bindings.groundSourcePortId,
    })
    const powerReferences = geometry.sections.flatMap((slice) => {
      return slice.references
        .filter((plane) => !ground.has(plane.sourceNetId))
        .map((plane) => ({
          plane,
          traces: slice.wires.map((wire) => wire.pcbTraceId),
          start: slice.startMm,
          end: slice.endMm,
        }))
    })
    const mapped = new Set(
      models.flatMap((model) => Object.values(model.spicePinMapping)),
    )
    const external = ports.filter((port) => {
      if (mapped.has(port.source_port_id)) return false
      const point: CopperPoint = [port.x, port.y]
      return port.layers.some((layer) =>
        findPadContactWire({
          geometry,
          pcbPortId: port.pcb_port_id,
          layer,
          point,
        }),
      )
    })
    const { maskThicknessSource } = extracted
    const maskDescription = {
      assumed: "assumed; absent from stackup",
      stackup: "stackup",
      explicit: "explicit material option",
    }[maskThicknessSource]
    const warnings = [
      ...extracted.warnings,
      ...transitions.warnings,
      ...models.flatMap((model) => model.warnings),
      [
        "JLC standard stackup (assumed): JLC08121H-3313;",
        `mask thickness ${materials.maskThicknessMm} mm (${maskDescription}).`,
        `Mask er=${materials.maskRelativePermittivity}, tan(delta)=${materials.maskLossTangent}`,
        `and laminate tan(delta)=${materials.laminateLossTangent}; explicit assumptions, not measured material data.`,
      ].join(" "),
      [
        "Numerical DC anchors: 1 Gohm per coarse route node;",
        "removes open-neighbour common-mode singularities without substituting a vendor load.",
      ].join(" "),
      [
        "Coplanar pours are not discretized into finite strip conductors;",
        "actual pours supply vertical references only.",
        "Their lateral shielding/coupling remains unqualified.",
      ].join(" "),
      [
        "Absent copper-layer volume is filled with nearest laminate;",
        "copper roughness, etch trapezoids and bend excess capacitance omitted.",
      ].join(" "),
      [
        "Oblique corrections apply selected-net to scoped-neighbour encounters within the same/adjacent layers;",
        "neighbour-to-neighbour oblique coupling is omitted.",
        "Added pair C uses existing isolated self C, a weak-coupling approximation.",
        "Placement is at the nearest ladder node; spacing is rounded outward to 1 um.",
      ].join(" "),
      [
        "Oblique surrogate blocked by an intervening local infinite reference plane is recorded as shielded,",
        "with plane-edge/aperture fringing omitted.",
      ].join(" "),
      "Power rail wires are ideal AC electrodes: their longitudinal impedance and power-plane impedance are omitted.",
      [
        `${external.length} external neighbour port bodies have open/ideal-logical terminations`,
        "without additional vendor die models; actual endpoint IDs are recorded.",
        "This is a candidate channel experiment,",
        "not a complete board/PDN simulation.",
      ].join(" "),
    ]
    const endpointNodes = Object.fromEntries(
      receiverPaths.flatMap(({ fromSourcePortId, toSourcePortId }) => [
        [
          fromSourcePortId,
          routedNode({ nodeMap: bindings.nodeMap, id: fromSourcePortId }),
        ],
        [
          toSourcePortId,
          routedNode({ nodeMap: bindings.nodeMap, id: toSourcePortId }),
        ],
      ]),
    )
    const { fastestEdgeSeconds, ...networkOptions } = options
    const evidence = {
      endpoint_nodes: endpointNodes,
      probes,
      label: "JLC standard stackup (assumed)",
      materials,
      mask_thickness_source: maskThicknessSource,
      options: { riseSeconds: fastestEdgeSeconds, ...networkOptions },
      scope,
      warnings,
      cells: ladder.cells,
      capped_skin_cells: ladder.cappedSkinCells,
      maximum_cell_delay_s: ladder.maximumDelaySeconds,
      coupling: extracted.pairCouplings,
      unique_cross_sections:
        extracted.crossSectionSolutions.length + oblique.solves,
      oblique_cross_sections: oblique.solves,
      oblique_encounters: oblique.records,
      sections: extracted.solvedWireSections.length,
      geometry_wires: geometry.wires.length,
      wires: geometry.wires,
      vias: geometry.vias,
      power_references: powerReferences,
      copper_overlap_patches: geometry.wires.filter(
        (wire) => wire.joins?.length,
      ),
      transitions: transitions.records,
      external_open_ports: external.map((port) => port.source_port_id),
      assembly: models.map((model) => ({
        name: model.name,
        metadata: model.metadata,
        warnings: model.warnings,
        sourceEvidence: model.sourceEvidence,
      })),
      routes: receiverPaths.map((receiverPath) => {
        const wires = geometry.wires.filter(
          (wire) => wire.sourceTraceId === receiverPath.sourceTraceId,
        )
        const {
          channelName,
          fromSourcePortId,
          toSourcePortId,
          sourceTraceId,
          sourceTraceIds,
        } = receiverPath
        const route = {
          port: channelName,
          from: fromSourcePortId,
          to: toSourcePortId,
          sourceTraceId,
          sourceTraceIds,
        }
        return {
          ...route,
          length_mm: wires.reduce(
            (sum, wire) =>
              sum + wire.longitudinalMaxMm - wire.longitudinalMinMm,
            0,
          ),
        }
      }),
      cross_sections: extracted.crossSectionSolutions.map(
        ({ crossSectionKey, rlgcMatrices }) => ({
          geometry: JSON.parse(crossSectionKey),
          C: rlgcMatrices.capacitanceFaradsPerMeter,
          L: rlgcMatrices.externalInductanceHenriesPerMeter,
          dcResistance: rlgcMatrices.dcResistanceOhmsPerMeter,
          skinResistance: rlgcMatrices.totalSkinResistanceOhmsPerMeterPerSqrtHz,
          dielectricLoss: rlgcMatrices.dielectricLossFaradsPerMeter,
          diagnostics: rlgcMatrices.diagnostics,
        }),
      ),
      slices: extracted.solvedWireSections.map((slice) => ({
        start: slice.startMm,
        end: slice.endMm,
        point: getWirePoint({
          wire: slice.wires[0],
          positionMm: (slice.startMm + slice.endMm) / 2,
        }),
        wires: slice.wires.map((wire) => wire.wireIndex),
        references: slice.references,
        key: slice.crossSectionKey,
      })),
    }
    evidence.warnings.unshift(...this.input.warnings)
    this.obliqueRecords = oblique.records
    const deck = `${lines.join("\n")}\n`
    const request = routedRequest({ deck })
    const compiled = snapshot<RoutedDeck>({
      simulationPcbTransientChannelSimulationId:
        this.input.simulationPcbTransientChannelSimulationId,
      name: this.input.name,
      deck,
      requestSha256: sha256(JSON.stringify(request)),
      probes,
      durationSeconds: options.durationSeconds,
      stepSeconds: options.stepSeconds,
      evidence,
    })
    const artifactScope = rootScope("simulation").child(
      this.input.artifactPrefix,
    )
    const artifacts = [
      artifactScope.text("simulation.cir", deck),
      artifactScope.json("evidence.json", evidence),
    ]
    return { value: compiled, artifacts }
  }
  /** No partial deck can be executed. */
  override getOutput(): Produced<RoutedDeck> {
    if (!this.output) throw new Error("Route network is incomplete")
    return this.output
  }
  /** Input snapshots only. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteNetworkSolver
  > {
    return [this.input]
  }

  /**
   * Coupling bands between parallel sections (width grows with k), ladder cells as ticks across the selected
   * copper, and every modelled via with the shared glyph.
   */
  override visualize(): GraphicsObject {
    const { geometry, bindings, extracted } = this.input
    const circuit = bindings.circuitJson
    const view = routeView({ circuit, scope: bindings.scope })
    let drawing = routeBoardDrawing({ circuit, scope: bindings.scope })
    let built: Set<number> | undefined
    if (!this.output) built = new Set(this.ladder?.wireNodes.keys() ?? [])
    const bands = extracted.solvedWireSections
      .flatMap((slice) =>
        slice.wires.flatMap((a, i) =>
          slice.wires.slice(i + 1).map((b, offset) => {
            const j = i + offset + 1
            const k = Math.max(
              Math.abs(slice.rlgcMatrices.capacitanceFaradsPerMeter[i][j]) /
                Math.sqrt(
                  slice.rlgcMatrices.capacitanceFaradsPerMeter[i][i] *
                    slice.rlgcMatrices.capacitanceFaradsPerMeter[j][j],
                ),
              Math.abs(
                slice.rlgcMatrices.externalInductanceHenriesPerMeter[i][j],
              ) /
                Math.sqrt(
                  slice.rlgcMatrices.externalInductanceHenriesPerMeter[i][i] *
                    slice.rlgcMatrices.externalInductanceHenriesPerMeter[j][j],
                ),
            )
            return {
              slice,
              a,
              b,
              k,
            }
          }),
        ),
      )
      .filter(({ a, b, k }) => {
        const visibleCoupling = k >= MINIMUM_DRAWN_COUPLING
        if (!visibleCoupling) return false
        if (!view.traces.has(a.pcbTraceId) && !view.traces.has(b.pcbTraceId))
          return false
        return !built || (built.has(a.wireIndex) && built.has(b.wireIndex))
      })
      .sort((p, q) => q.k - p.k)
      .slice(0, 800)
    for (const { slice, a, b, k } of bands) {
      const middle = (a.lateralOffsetMm + b.lateralOffsetMm) / 2
      const half =
        (Math.max(
          0,
          Math.abs(a.lateralOffsetMm - b.lateralOffsetMm) -
            (a.widthMm + b.widthMm) / 2,
        ) /
          2) *
        Math.min(1, k / 0.25)
      drawing.polygons!.push({
        points: [
          offsetPoint({
            wire: a,
            position: slice.startMm,
            transverse: middle - half,
          }),
          offsetPoint({
            wire: a,
            position: slice.endMm,
            transverse: middle - half,
          }),
          offsetPoint({
            wire: a,
            position: slice.endMm,
            transverse: middle + half,
          }),
          offsetPoint({
            wire: a,
            position: slice.startMm,
            transverse: middle + half,
          }),
        ],
        fill: routeTones.coupling,
        stroke: "none",
        label: `k ${k.toFixed(2)}`,
      })
    }
    const wires = new Map(geometry.wires.map((wire) => [wire.wireIndex, wire]))
    const nodes = [...(this.ladder?.wireNodes ?? [])].flatMap(
      ([id, samples]) => {
        const wire = wires.get(id)
        if (!view.traces.has(wire?.pcbTraceId ?? "")) return []
        return samples.map((sample) => ({
          wire: wire!,
          position: sample.position,
        }))
      },
    )
    for (const { wire, position } of routeDisplayItems({
      items: nodes,
      limit: 1500,
    })) {
      const [x, y] = getWirePoint({ wire, positionMm: position })
      drawing.lines!.push({
        points: [-1, 1].map((sign) => ({
          x: x - sign * wire.direction[1] * wire.widthMm * 1.4,
          y: y + sign * wire.direction[0] * wire.widthMm * 1.4,
        })),
        strokeColor: routeTones.cell,
        strokeWidth: wire.widthMm * 0.3,
      })
    }
    for (const record of routeDisplayItems({
      items: this.obliqueRecords,
      limit: 120,
    })) {
      if (!Array.isArray(record.wires) || record.wires.length !== 2) continue
      const pair = (record.wires as number[]).map((id) => wires.get(id))
      if (!pair[0] || !pair[1]) continue
      const near = findClosestWirePoints({
        firstWire: pair[0],
        secondWire: pair[1],
      })
      drawing.lines!.push({
        points: [near.firstPoint, near.secondPoint].map(([x, y]) => ({ x, y })),
        strokeColor: routeTones.coupling,
        strokeWidth: view.unit * 0.3,
      })
    }
    const records = this.output?.value.evidence.transitions
    let transitions: Record<string, unknown>[] = []
    if (Array.isArray(records)) transitions = records
    const physical = new Map(
      cju([...circuit])
        .pcb_via.list()
        .map((item) => [item.pcb_via_id, item]),
    )
    const { minX, maxX, minY, maxY } = view.focus
    const selected = geometry.wires.filter((wire) =>
      view.traces.has(wire.pcbTraceId),
    )
    let width = view.unit
    if (selected.length)
      width =
        selected.reduce((sum, wire) => sum + wire.widthMm, 0) / selected.length
    for (const record of transitions) {
      if (record.kind !== "via") continue
      const via = physical.get(String(record.id))
      if (
        via &&
        via.x >= minX &&
        via.x <= maxX &&
        via.y >= minY &&
        via.y <= maxY
      )
        drawing.polygons!.push(
          ...routeVia({
            center: via,
            radius: width * 1.4,
          }),
        )
    }
    // The pane unrolls each net with its ladder cells as ticks and its coupling as violet under the bar.
    const unrolled = routeUnrolled({ view, wires: geometry.wires })
    const lengths = routeLengths({ circuit, view })
    const rows = new Map<RouteStripRow["net"]["label"], RouteStripRow>(
      lengths.map((row) => [
        row.net.label,
        {
          ...row,
          length: unrolled.lengths.get(row.net) ?? row.length,
          ticks: [],
          bands: [],
        },
      ]),
    )
    for (const { wire, position } of nodes) {
      const at = unrolled.along({ id: wire.wireIndex, position })
      if (at) rows.get(at.net.label)?.ticks!.push(at.distance)
    }
    for (const { slice, a, b, k } of bands)
      for (const wire of [a, b]) {
        const from = unrolled.along({
          id: wire.wireIndex,
          position: slice.startMm,
        })
        const to = unrolled.along({ id: wire.wireIndex, position: slice.endMm })
        if (from && to)
          rows
            .get(from.net.label)
            ?.bands!.push({ from: from.distance, to: to.distance, k })
      }
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: routeStrip({ pane: view.pane, rows: [...rows.values()] }),
    })
    if (this.failed)
      drawing.texts!.push(
        ...routeFailure({
          box: view.pane,
          message: this.error ?? "Network rejected",
        }),
      )
    return drawing
  }
}

/** Every physical port was allocated by declarations before binding completed. */
function routedNode({
  nodeMap,
  id,
}: {
  nodeMap: RouteNetworkInput["bindings"]["nodeMap"]
  id: SourcePortId
}): string {
  const node = nodeMap[id]
  if (node === undefined)
    throw new Error(`Unknown routed electrical port ${id}`)
  return node
}

/** Resolves a physical point on a routed wire to its electrical node. */
export type RouteEndpoint = (input: {
  wire: Snapshot<TraceWire>
  point: Snapshot<CopperPoint>
}) => string

/** Rail wires are explicit ideal AC electrodes; all other route junctions share physical coordinates. */
function createRouteEndpoint({
  scope,
  known,
}: {
  scope: RouteNetworkInput["bindings"]["scope"]
  known: ReadonlyMap<RouteContactKey, string>
}): RouteEndpoint {
  const nodes = new Map(known)
  return ({ wire, point }) => {
    if (scope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId)) return "0"
    const id = routeContactKey({ layer: wire.layer, point })
    const existing = nodes.get(id)
    if (existing) return existing
    const node = `route${nodes.size}`
    nodes.set(id, node)
    return node
  }
}

/** Project a position along a wire at a different transverse offset. */
function offsetPoint({
  wire,
  position,
  transverse,
}: {
  wire: Snapshot<TraceWire>
  position: number
  transverse: number
}): Point {
  const [x, y] = getWirePoint({
    wire: { ...wire, lateralOffsetMm: transverse },
    positionMm: position,
  })
  return { x, y }
}
