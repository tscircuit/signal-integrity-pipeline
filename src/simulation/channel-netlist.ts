import { BaseSolver } from "@tscircuit/solver-utils"
import {
  type CircuitJson,
  type CopperScope,
  cloneCircuitJson,
  type ReceiverTracePath,
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
  readonly copperScope: Snapshot<CopperScope>
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
  "circuitJson" | "copperScope" | "receiverPaths"
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
  private readonly input: ChannelNetlistInput
  private state?: ChannelNetlistState
  private readonly models: CompiledIbisComponent[] = []
  private output?: Produced<ChannelNetlist>

  /** Capture the board, scope, experiment inputs and raw IBIS sources for this run. */
  constructor(input: ChannelNetlistInput) {
    super()
    const { ibisSources, ...netlistInput } = input
    this.input = Object.freeze({
      ...snapshot(netlistInput),
      ibisSources: captureIbisSources(ibisSources),
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
    if (!this.state) {
      this.state = this.initialize()
      this.MAX_ITERATIONS = this.state.plan.models.length
    }
    const { plan, sources } = this.state
    const model = plan.models[this.models.length]
    const [[compiled]] = compileBuffers({
      validated: sources.value,
      plans: [{ ...plan, models: [model] }],
      define: modelRunDefinition,
    })
    this.models.push(compiled)
    this.stats = {
      models: this.models.length,
      probes: plan.probes.length,
      warnings: this.models.reduce(
        (count, buffer) => count + buffer.warnings.length,
        0,
      ),
    }
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
    const { circuitJson, copperScope, receiverPaths, artifactPrefix } =
      this.input
    const value: ChannelNetlist = Object.freeze({
      circuitJson,
      copperScope,
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
}
