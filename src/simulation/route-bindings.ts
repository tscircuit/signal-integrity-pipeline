import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { PcbComponent, PcbPort } from "circuit-json"
import type { GraphicsObject } from "graphics-debug"
import {
  cloneCircuitJson,
  routeBoardDrawing,
  routeBuffers,
  routeFailure,
  routeLengths,
  routeOutline,
  routePinDirection,
  routePortPoint,
  routeStrip,
  routeTones,
  routeView,
  withRouteDrawing,
} from "../board"
import {
  type AssemblyEntry,
  compileBuffers,
  ibisAssembly,
  type ValidatedIbisSources,
  validateIbisSources,
} from "../buffers"
import {
  type Artifact,
  type ArtifactScope,
  type Produced,
  rootScope,
  type Snapshot,
  snapshot,
} from "../kernel"
import { generalDeclarations, modelRunDefinition } from "./declarations"
import { extractedNonrailSourceTraceIds } from "./ideal-connectivity"
import { electricalSources } from "./netlist"
import type {
  RouteBuffer,
  RoutedBindings,
  ScopedRouteBindingsInput,
} from "./route-inputs"
import type { Declarations, SimulationPlan } from "./types"

/** Bind one vendor buffer per step; electrical names retain source-record order. */
export class RouteBindingsSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private declarations?: Declarations
  private validatedSources?: ValidatedIbisSources
  private plan?: SimulationPlan
  private electricalLines: string[] = []
  private readonly models: RouteBuffer[] = []
  private readonly assembly: AssemblyEntry[] = []
  private readonly artifacts: Artifact[] = []
  private output?: Produced<RoutedBindings>
  /** Inputs contain domain intent, never another stage's internals. */
  constructor(private readonly input: ScopedRouteBindingsInput) {
    super()
  }
  /** Allocate circuit nodes before compiling the first IBIS buffer. */
  private initialize(scope: ArtifactScope): Declarations {
    if (this.declarations) return this.declarations
    const {
      circuitJson: plannedCircuitJson,
      copperScope,
      receiverPaths,
      traceContacts,
      modeling,
      controls,
      options,
      ibisSources,
    } = this.input
    if (!traceContacts.length)
      throw new Error("Routed compilation requires physical signal traces")
    const circuitJson = cloneCircuitJson(plannedCircuitJson)
    const additionalSourceTraceIds = extractedNonrailSourceTraceIds({
      db: cju([...circuitJson]),
      copperScope,
    })
    const declarations = generalDeclarations({
      circuit: circuitJson,
      receiverPaths,
      traceContacts,
      additionalSourceTraceIds,
      modeling,
      controls,
    })
    this.declarations = declarations
    this.plan = {
      ...declarations.plans[0],
      durationSeconds: options.durationSeconds,
      maxStepSeconds: options.stepSeconds,
    }
    this.electricalLines = electricalSources({
      circuit: circuitJson,
      modeling,
      nodes: declarations.nodes,
    }).lines
    const validatedSources = validateIbisSources({
      models: declarations.models,
      ibisSources,
      scope,
    })
    this.validatedSources = validatedSources.value
    this.artifacts.push(...validatedSources.artifacts)
    return declarations
  }

  /** Cut physical copper out of ideal connectivity, then compile one original IBIS model. */
  override _step(): void {
    const scope = rootScope("buffers").child(this.input.artifactPrefix)
    const declarations = this.initialize(scope)
    const model = declarations.models[this.models.length]
    if (model) {
      if (!this.validatedSources)
        throw new Error("IBIS model sources were not validated")
      const [compiled] = compileBuffers({
        validated: this.validatedSources,
        plans: [{ ...this.plan!, models: [model] }],
        define: modelRunDefinition,
      })[0]
      this.models.push({
        name: compiled.name,
        source: compiled.source,
        spicePinMapping: compiled.spicePinMapping,
        metadata: compiled.metadata,
        warnings: compiled.warnings,
        sourceEvidence: compiled.sourceEvidence,
      })
      this.assembly.push(
        ...ibisAssembly({ models: [compiled], experiment: scope }).value,
      )
    }
    const warnings = this.models.reduce(
      (count, model) => count + model.warnings.length,
      0,
    )
    this.stats = {
      models: this.models.length,
      probes: this.plan!.probes.length,
      warnings,
    }
    if (this.models.length !== declarations.models.length) return
    const bindings: RoutedBindings = Object.freeze({
      circuitJson: cloneCircuitJson(this.input.circuitJson),
      ...snapshot({
        scope: this.input.copperScope,
        receiverPaths: this.input.receiverPaths,
        plan: this.plan!,
        nodeMap: declarations.nodes.mapping,
        groundSourcePortId: declarations.nodes.groundSourcePortId,
        electricalLines: this.electricalLines,
        models: this.models,
      }),
    })
    const simulationScope = rootScope("simulation").child(
      this.input.artifactPrefix,
    )
    this.artifacts.push(
      scope.json("native-ibis-assembly.json", this.assembly),
      simulationScope.json("electrical-node-map.json", {
        nodes: bindings.nodeMap,
        channelReferenceSourcePortId: bindings.groundSourcePortId,
      }),
    )
    this.output = { value: bindings, artifacts: this.artifacts }
    this.solved = true
  }
  /** Complete immutable bindings only. */
  override getOutput(): Produced<RoutedBindings> {
    if (!this.output) throw new Error("Route bindings are incomplete")
    return this.output
  }
  /** Original input without converter objects. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteBindingsSolver
  > {
    return [this.input]
  }

  /**
   * Bound components outlined, IBIS buffer glyphs at their signal pins (▶ driver, ◀ receiver) and rail pins as
   * grey dots; unbound lane ends turn red.
   */
  override visualize(): GraphicsObject {
    const circuit = cloneCircuitJson(this.input.circuitJson)
    const view = routeView({ circuit, scope: this.input.copperScope })
    let drawing = routeBoardDrawing({ circuit, scope: this.input.copperScope })
    const db = cju([...circuit])
    const pcbPorts = new Map(
      db.pcb_port.list().map((port) => [port.source_port_id, port]),
    )
    const components = new Map(
      db.pcb_component
        .list()
        .map((component) => [component.pcb_component_id, component]),
    )
    const outlineContext = {
      pcbPorts,
      components,
      unit: view.unit,
    }
    const buffers = this.models.flatMap((model) => {
      drawing.polygons!.push(
        ...portComponentOutlines({
          ports: Object.values(model.spicePinMapping),
          color: routeTones.via,
          label: model.name,
          context: outlineContext,
        }),
      )
      return [...new Set(Object.values(model.spicePinMapping))].flatMap(
        (id) => {
          const point = routePortPoint({ circuit, sourcePortId: id })
          if (!point) return []
          const mappedSignal = this.input.receiverPaths.some(
            (mapping) =>
              mapping.fromSourcePortId === id || mapping.toSourcePortId === id,
          )
          if (
            !mappedSignal ||
            !model.metadata.pins.some((pin) => pin.port === id)
          ) {
            drawing.circles!.push({
              center: point,
              radius: view.unit * 0.3,
              fill: routeTones.quiet,
              stroke: routeTones.quiet,
            })
            return []
          }
          const net = view.ports.get(id)
          return [
            {
              point,
              direction: routePinDirection({ circuit, view, pin: point }),
              color: net?.color ?? routeTones.copper,
              driver: Boolean(
                this.plan?.states.some(
                  (state) => state.source_port_id === id && state.is_output,
                ),
              ),
              label: net?.label,
            },
          ]
        },
      )
    })
    drawing.polygons!.push(...routeBuffers({ buffers, unit: view.unit }))
    // Each bound net unrolled, its driver and receiver glyphs at the ends once both are bound.
    const bound = new Set(buffers.map((buffer) => buffer.label))
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: routeStrip({
        pane: view.pane,
        rows: routeLengths({ circuit, view }).filter((row) =>
          bound.has(row.net.label),
        ),
        buffers: { driver: true, receiver: true },
      }),
    })
    if (this.failed) {
      drawing.polygons!.push(
        ...portComponentOutlines({
          ports: this.input.receiverPaths.flatMap((mapping) => [
            mapping.fromSourcePortId,
            mapping.toSourcePortId,
          ]),
          color: routeTones.failure,
          label: "unbound",
          context: outlineContext,
        }),
      )
      drawing.texts!.push(
        ...routeFailure({
          box: view.pane,
          message: this.error ?? "IBIS binding unavailable",
        }),
      )
    }
    return drawing
  }
}

/** Circuit lookups and drawing scale shared by all component outlines. */
interface PortOutlineContext {
  pcbPorts: ReadonlyMap<PcbPort["source_port_id"], PcbPort>
  components: ReadonlyMap<
    PcbComponent["pcb_component_id"],
    Snapshot<PcbComponent>
  >
  unit: number
}

/** Outline the parts that own the selected ports. */
function portComponentOutlines({
  ports,
  color,
  label,
  context,
}: {
  ports: Iterable<PcbPort["source_port_id"]>
  color: string
  label: string
  context: PortOutlineContext
}): NonNullable<GraphicsObject["polygons"]> {
  const outlines: NonNullable<GraphicsObject["polygons"]> = []
  const { pcbPorts, components, unit } = context
  for (const id of new Set(
    [...ports].map((port) => pcbPorts.get(port)?.pcb_component_id),
  )) {
    if (!id) continue
    const component = components.get(id)
    if (component)
      outlines.push({
        points: routeOutline(component),
        stroke: color,
        strokeWidth: unit * 0.2,
        label,
      })
  }
  return outlines
}
