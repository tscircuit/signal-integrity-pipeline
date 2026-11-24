import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  type CopperPoint,
  cloneCircuitJson,
  findPadContactWire,
  getSourcePortConnectivityMapFromCircuitJson,
  getWirePoint,
  type SourcePortId,
  sourceNetMembers,
  type TraceWire,
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

/** Physical node identity, coupled ladders, corrections and the single deck assembly. */
export class RouteNetworkSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private steps?: Generator<void, Produced<RoutedDeck>>
  private output?: Produced<RoutedDeck>
  private ladder?: RouteLadder
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
