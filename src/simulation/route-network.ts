import { BaseSolver } from "@tscircuit/solver-utils"
import {
  connectedSourceIds,
  type RouteWire,
  type RouteXY,
  routeContactFrame,
  routePosition,
} from "../board"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import { branchSaves } from "./branch-saves"
import { namespaceSpice } from "./netlist"
import { type RouteLadder, routeLadderSteps } from "./route-ladder"
import { routeOblique } from "./route-oblique"
import { routedRequest } from "./route-transient"
import { routeTransitions } from "./route-transitions"
import { routedControl } from "./routed-control"
import type { RoutedDeck, RouteNetworkInput } from "./routed-types"
import { spiceSubcircuitHeader, spiceWords } from "./spice-header"

/** Physical node identity, coupled ladders, corrections and the single deck assembly. */
export class RouteNetworkSolver extends BaseSolver {
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
    if (result.done) {
      this.output = result.value
      this.solved = true
    }
  }
  /** Preserve the original compiler's exact node and SPICE ordering. */
  private *build(): Generator<void, Produced<RoutedDeck>> {
    const { geometry, extracted, bindings, options, materials } = this.input
    const { scope, models, mappings } = bindings
    const plan = structuredClone(bindings.plan)
    const electrical = { lines: bindings.electricalLines }
    const maskLayers = bindings.circuitJson
      .filter((record) => record.type === "pcb_stackup")[0]
      .layers.filter((layer) => layer.layer_type === "soldermask")
    const aliases: string[] = []
    const known = new Map<RouteJunctionKey, string>()
    for (const port of bindings.circuitJson.filter(
      (record) => record.type === "pcb_port",
    ))
      for (const layer of port.layers) {
        if (
          !routeContactFrame({
            geometry,
            scope,
            layer,
            point: [port.x, port.y],
          })
        )
          continue
        const id = junctionKey(layer, [port.x, port.y])
        const portNode = routedNode(bindings.nodeMap, port.source_port_id)
        const previous = known.get(id)
        if (previous && previous !== portNode) {
          aliases.push(`RALIAS${aliases.length} ${previous} ${portNode} 1e-6`)
          continue
        }
        known.set(id, portNode)
      }
    const endpoint = createRouteEndpoint(scope, known)
    for (const wire of geometry.wires)
      for (const join of wire.joins ?? []) {
        const from = endpoint(wire, join.from)
        const to = endpoint(wire, join.to)
        if (from !== to)
          aliases.push(`RJOIN${aliases.length} ${from} ${to} 1e-6`)
      }
    const steps = routeLadderSteps({
      extracted,
      endpoint,
      riseSeconds: options.riseSeconds,
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
    const lines = [
      "Routed quasi-TEM coupled 2D extraction; JLC standard stackup (assumed)",
      `.options klu reltol=1e-4 abstol=${options.currentToleranceA ?? 1e-9} vntol=1e-6 method=gear maxord=2 pivrel=0.1`,
      ...electrical.lines,
    ]
    const saved: string[] = []
    for (const [i, model] of models.entries()) {
      const namespaced = namespaceSpice(model.source, `I${i}`)
      const header = spiceSubcircuitHeader(model.source)!
      const nodes = spiceWords(header[1]).map((terminal) =>
        routedNode(bindings.nodeMap, model.spicePinMapping[terminal]),
      )
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
    ])
      for (const line of collection) lines.push(line)
    const biasNodes = [
      ...new Set(
        [...ladder.wireNodes.values()]
          .flatMap((records) => records.map((record) => record.node))
          .concat(
            models.flatMap((model) =>
              Object.values(model.spicePinMapping).map((port) =>
                routedNode(bindings.nodeMap, port),
              ),
            ),
          ),
      ),
    ].filter((node) => node !== "0")
    for (const [i, node] of biasNodes.entries())
      lines.push(`RBIAS${i} ${node} 0 1e9`)
    for (const probe of [...plan.probes].filter(
      (probe) => probe.referenceNode !== "0",
    )) {
      for (const [suffix, signalNode, signalSourceId] of [
        ["P", probe.signalNode, probe.signalSourceId],
        ["N", probe.referenceNode, probe.referenceSourceId],
      ] as const)
        plan.probes.push({
          ...probe,
          name: `${probe.name}_${suffix}`,
          simulationVoltageProbeId: `${probe.simulationVoltageProbeId}_${suffix}`,
          column: plan.probes.length + 1,
          signalNode,
          signalSourceId: signalSourceId!,
          referenceNode: "0",
          referenceSourceId: bindings.groundSourcePortId,
        })
    }
    // Only save receiver nodes and behavioural-source branch dependencies; the engine exposes the resulting vectors.
    const save = [
      ...new Set(
        plan.probes
          .flatMap((probe) => [probe.signalNode, probe.referenceNode])
          .filter((node) => node !== "0"),
      ),
    ]
      .map((node) => `v(${node})`)
      .concat(saved)
      .join(" ")
    lines.push(
      ...routedControl({
        saved: save,
        step: options.stepSeconds,
        duration: options.durationSeconds,
      }),
    )
    const ground = connectedSourceIds(
      bindings.circuitJson,
      bindings.groundSourcePortId,
    )
    const powerReferences = geometry.slices.flatMap((slice) =>
      slice.references
        .filter((plane) => !ground.has(plane.net))
        .map((plane) => ({
          plane,
          traces: slice.wires.map((wire) => wire.trace),
          start: slice.start,
          end: slice.end,
        })),
    )
    const mapped = new Set(
      models.flatMap((model) => Object.values(model.spicePinMapping)),
    )
    const external = bindings.circuitJson
      .filter((record) => record.type === "pcb_port")
      .filter(
        (port) =>
          !mapped.has(port.source_port_id) &&
          port.layers.some((layer) =>
            routeContactFrame({
              geometry,
              scope,
              layer,
              point: [port.x, port.y],
            }),
          ),
      )
    let maskThicknessSource = "assumed"
    let maskDescription = "assumed; absent from preset"
    if (maskLayers.length) maskThicknessSource = maskDescription = "preset"
    if (options.materials) {
      maskThicknessSource = "explicit"
      maskDescription = "explicit material option"
    }
    const warnings = [
      ...extracted.warnings,
      ...transitions.warnings,
      ...models.flatMap((model) => model.warnings),
      `JLC standard stackup (assumed): JLC08121H-3313; mask thickness ${materials.maskMm} mm (${maskDescription}). Mask er=${materials.maskEr}, tan(delta)=${materials.maskLoss} and laminate tan(delta)=${materials.substrateLoss}; explicit assumptions, not measured material data.`,
      "Numerical DC anchors: 1 Gohm per coarse route node; removes open-neighbour common-mode singularities without substituting a vendor load.",
      "Coplanar pours are not discretized into finite strip conductors; actual pours supply vertical references only. Their lateral shielding/coupling remains unqualified.",
      "Absent copper-layer volume is filled with nearest laminate; copper roughness, etch trapezoids and bend excess capacitance omitted.",
      "Oblique corrections apply selected-net to scoped-neighbour encounters within the same/adjacent layers; neighbour-to-neighbour oblique coupling is omitted. Added pair C uses existing isolated self C, a weak-coupling approximation. Placement is at the nearest ladder node; spacing is rounded outward to 1 um.",
      "Oblique surrogate blocked by an intervening local infinite reference plane is recorded as shielded, with plane-edge/aperture fringing omitted.",
      "Power rail wires are ideal AC electrodes: their longitudinal impedance and power-plane impedance are omitted.",
      `${external.length} external neighbour port bodies have open/ideal-logical terminations without additional vendor die models; actual endpoint IDs are recorded. This is a candidate channel experiment, not a complete board/PDN simulation.`,
    ]
    const evidence = {
      endpoint_nodes: Object.fromEntries(
        mappings.flatMap((mapping) => [
          [mapping.from, routedNode(bindings.nodeMap, mapping.from)],
          [mapping.to, routedNode(bindings.nodeMap, mapping.to)],
        ]),
      ),
      probes: plan.probes,
      label: "JLC standard stackup (assumed)",
      materials,
      mask_thickness_source: maskThicknessSource,
      options,
      scope,
      warnings,
      cells: ladder.cells,
      capped_skin_cells: ladder.cappedSkinCells,
      maximum_cell_delay_s: ladder.maximumDelaySeconds,
      coupling: extracted.coupling,
      unique_cross_sections: extracted.sections.length + oblique.solves,
      oblique_cross_sections: oblique.solves,
      oblique_encounters: oblique.records,
      sections: extracted.slices.length,
      geometry_wires: geometry.wires.length,
      wires: geometry.wires,
      via_contacts: geometry.viaContacts,
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
      routes: mappings.map((mapping) => ({
        ...mapping,
        length_mm: geometry.wires
          .filter((wire) => wire.source === mapping.sourceTraceId)
          .reduce((sum, wire) => sum + wire.end - wire.start, 0),
      })),
      cross_sections: extracted.sections.map(({ key, line }) => ({
        geometry: JSON.parse(key),
        C: line.C,
        L: line.L,
        dcResistance: line.dcResistance,
        skinResistance: line.skinResistance,
        dielectricLoss: line.dielectricLoss,
        diagnostics: line.diagnostics,
      })),
      slices: extracted.slices.map((slice) => ({
        start: slice.start,
        end: slice.end,
        point: routePosition(slice.wires[0], (slice.start + slice.end) / 2),
        wires: slice.wires.map((wire) => wire.id),
        references: slice.references,
        key: slice.key,
      })),
    }
    evidence.warnings.unshift(...this.input.warnings)
    const deck = lines.join("\n") + "\n"
    const compiled = snapshot({
      blockId: this.input.blockId,
      name: this.input.name,
      deck,
      requestSha256: sha256(JSON.stringify(routedRequest({ deck }))),
      probes: plan.probes,
      durationSeconds: options.durationSeconds,
      stepSeconds: options.stepSeconds,
      evidence,
    })
    const artifactScope = rootScope("simulation").child(
      this.input.artifactPrefix,
    )
    return {
      value: compiled,
      artifacts: [
        artifactScope.text("simulation.cir", deck),
        artifactScope.json("evidence.json", evidence),
      ],
    }
  }
  /** No partial deck can be executed. */
  override getOutput(): Produced<RoutedDeck> {
    if (!this.output) throw new Error("Route network is incomplete")
    return this.output
  }
  /** Input snapshots only. */
  override getConstructorParams(): [RouteNetworkInput] {
    return [this.input]
  }
}

type RouteJunctionKey = string

/** Every physical port was allocated by declarations before binding completed. */
function routedNode(
  nodeMap: RouteNetworkInput["bindings"]["nodeMap"],
  id: string,
): string {
  const node = nodeMap[id]
  if (node === undefined)
    throw new Error(`Unknown routed electrical port ${id}`)
  return node
}

/** Coordinates join actual physical copper only. */
function junctionKey(layer: string, point: RouteXY): RouteJunctionKey {
  return `${layer}:${point.map((n) => n.toFixed(6)).join(",")}`
}

/** Rail wires are explicit ideal AC electrodes; all other route junctions share physical coordinates. */
function createRouteEndpoint(
  scope: RouteNetworkInput["bindings"]["scope"],
  known: Map<RouteJunctionKey, string>,
): (wire: RouteWire, point: RouteXY) => string {
  return (wire, point) => {
    if (scope.nonReferenceRailTraceIds.includes(wire.trace)) return "0"
    const id = junctionKey(wire.layer, point)
    let node = known.get(id)
    if (!node) {
      node = `route${known.size}`
      known.set(id, node)
    }
    return node
  }
}
