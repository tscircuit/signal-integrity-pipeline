import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { PcbComponent, PcbPort } from "circuit-json"
import type { GraphicsObject } from "graphics-debug"
import {
  type CircuitJson,
  type CopperScope,
  cloneCircuitJson,
  type ReceiverTracePath,
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
  type CompiledIbisComponent,
  captureIbisSources,
  compileBuffers,
  type IbisSources,
  ibisAssembly,
  type ValidatedIbisSources,
  validateIbisSources,
} from "../buffers"
import {
  type ArtifactScope,
  type Produced,
  rootScope,
  type Snapshot,
  snapshot,
} from "../kernel"
import { generalDeclarations, modelRunDefinition } from "./declarations"
import { fail } from "./diagnostics"
import { electricalSources } from "./netlist"
import type { TraceContacts } from "./route-inputs"
import type {
  CircuitNodes,
  RunControls,
  SimulationModeling,
  SimulationPlan,
} from "./types"

/** The planner's scoped board and lowered inputs for one channel simulation. */
export interface ChannelNetlistInput {
  readonly circuitJson: Snapshot<CircuitJson>
  readonly receiverPaths: readonly ReceiverTracePath[]
  readonly traceContacts: readonly TraceContacts[]
  readonly modeling: Snapshot<SimulationModeling>
  readonly controls: Snapshot<Record<string, RunControls>>
  readonly ibisSources: Readonly<IbisSources>
  readonly artifactPrefix: string
}

/** Compiled IBIS buffer data needed to wire the channel deck. */
type ChannelBuffer = Pick<
  CompiledIbisComponent,
  | "name"
  | "source"
  | "spicePinMapping"
  | "metadata"
  | "warnings"
  | "sourceEvidence"
>

/** Immutable node assignments, electrical elements and IBIS buffers for one channel simulation. */
export type ChannelNetlist = Pick<
  ChannelNetlistInput,
  "circuitJson" | "receiverPaths"
> &
  Snapshot<{
    plan: SimulationPlan
    nodeMap: CircuitNodes["mapping"]
    groundSourcePortId: CircuitNodes["groundSourcePortId"]
    electricalLines: string[]
    models: ChannelBuffer[]
  }>

/** Validated experiment, electrical nodes and buffer sources for the current run. */
interface ChannelNetlistState {
  plan: SimulationPlan
  nodes: CircuitNodes
  electricalLines: string[]
  sources: Produced<ValidatedIbisSources>
  scope: ArtifactScope
}

/** Allocate electrical nodes and compile one IBIS model per step. */
export class ChannelNetlistSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity

  private readonly input: ChannelNetlistInput
  private state?: ChannelNetlistState
  private readonly models: CompiledIbisComponent[] = []
  private output?: Produced<ChannelNetlist>

  /** Capture the board, experiment inputs and raw IBIS sources for this run. */
  constructor(input: ChannelNetlistInput) {
    super()
    this.input = Object.freeze({
      ...snapshot({
        circuitJson: input.circuitJson,
        receiverPaths: input.receiverPaths,
        traceContacts: input.traceContacts,
        modeling: input.modeling,
        controls: input.controls,
        artifactPrefix: input.artifactPrefix,
      }),
      ibisSources: captureIbisSources(input.ibisSources),
    })
  }

  /** Resolve the plan and validate every IBIS source it uses. */
  private initialize(): ChannelNetlistState {
    const {
      circuitJson,
      receiverPaths,
      traceContacts,
      modeling,
      controls,
      ibisSources,
      artifactPrefix,
    } = this.input
    const experimentCount = circuitJson.filter(
      ({ type }) => type === "simulation_experiment",
    ).length
    if (experimentCount !== 1)
      fail(
        "simulation_experiment",
        `Channel netlist requires exactly one experiment, got ${experimentCount}`,
      )
    const circuit = cloneCircuitJson(circuitJson)
    const { plans, nodes } = generalDeclarations({
      circuit,
      receiverPaths,
      traceContacts,
      modeling,
      controls,
    })
    const [plan] = plans
    const scope = rootScope("buffers").child(artifactPrefix)
    return {
      plan,
      nodes,
      electricalLines: electricalSources({ circuit, modeling, nodes }).lines,
      sources: validateIbisSources({ models: plan.models, ibisSources, scope }),
      scope,
    }
  }

  /** Compile the next model and publish the netlist after the last one. */
  override _step(): void {
    this.state ??= this.initialize()
    const { plan, sources } = this.state
    const model = plan.models[this.models.length]
    const [[compiled]] = compileBuffers({
      validated: sources.value,
      plans: [{ ...plan, models: [model] }],
      define: modelRunDefinition,
    })
    this.models.push(compiled)
    this.stats = { models: this.models.length }
    if (this.models.length !== plan.models.length) return
    this.finalize(this.state)
    this.solved = true
  }

  /** Publish a frozen node map, compiled buffers and assembly artifacts. */
  private finalize({
    plan,
    nodes,
    electricalLines,
    sources,
    scope,
  }: ChannelNetlistState): void {
    const { circuitJson, receiverPaths, artifactPrefix } = this.input
    const value: ChannelNetlist = Object.freeze({
      circuitJson,
      receiverPaths,
      ...snapshot({
        plan,
        nodeMap: nodes.mapping,
        groundSourcePortId: nodes.groundSourcePortId,
        electricalLines,
        models: this.models.map(
          ({
            name,
            source,
            spicePinMapping,
            metadata,
            warnings,
            sourceEvidence,
          }): ChannelBuffer => ({
            name,
            source,
            spicePinMapping,
            metadata,
            warnings,
            sourceEvidence,
          }),
        ),
      }),
    })
    const assembly = ibisAssembly({ models: this.models, experiment: scope })
    const nodeMapArtifact = rootScope("simulation")
      .child(artifactPrefix)
      .json("electrical-node-map.json", {
        nodes: nodes.mapping,
        channelReferenceSourcePortId: nodes.groundSourcePortId,
      })
    this.output = Object.freeze({
      value,
      artifacts: snapshot([
        ...sources.artifacts,
        ...assembly.artifacts,
        nodeMapArtifact,
      ]),
    })
  }

  /** Return the completed netlist and its artifacts. */
  override getOutput(): Produced<ChannelNetlist> {
    if (!this.output) throw new Error("Channel netlist is incomplete")
    return this.output
  }

  /** Return the captured solver input. */
  override getConstructorParams(): ConstructorParameters<
    typeof ChannelNetlistSolver
  > {
    return [this.input]
  }

  /**
   * Draw compiled buffers at their signal pins and rail pins as grey dots.
   * Missing buffers are outlined in red.
   */
  protected visualizeNetlist(
    copperScope: Snapshot<CopperScope>,
  ): GraphicsObject {
    const circuit = cloneCircuitJson(this.input.circuitJson)
    const view = routeView({ circuit, scope: copperScope })
    let drawing = routeBoardDrawing({ circuit, scope: copperScope })
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
                this.state?.plan.states.some(
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
          message: this.error ?? "Channel netlist unavailable",
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
