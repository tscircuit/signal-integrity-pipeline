import type { PipelineStep } from "@tscircuit/solver-utils"
import {
  BasePipelineSolver,
  type BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import {
  type CopperGeometry,
  CopperGeometryExtractionSolver,
  cloneCircuitJson,
} from "../board"
import { type ExtractedRoutes, RouteFieldsSolver } from "../extraction"
import {
  ArtifactLedger,
  type FileMap,
  type Produced,
  rootScope,
  type Snapshot,
  snapshot,
} from "../kernel"
import {
  RouteBindingsSolver,
  type RoutedBindings,
  type RoutedCapture,
  type RoutedDeck,
  RouteNetworkSolver,
  RouteTransientSolver,
} from "../simulation"
import type { SolverContext } from "../solver"
import {
  capturePlanInput,
  type TransientChannelSimulationPlanInput,
} from "./plan/input"
import { type RoutedStageOutput, routedStage } from "./routed-stage"
import {
  type TransientChannelSimulationPlan,
  TransientChannelSimulationPlanSolver,
} from "./transient-channel-simulation-plan"

/** All six rows exist before the first step; every stage drains all planned channel simulations in order. */
export const routedStages = [
  definePipelineStep(
    "TransientChannelSimulationPlanSolver",
    TransientChannelSimulationPlanSolver,
    (p: RoutedPipelineSolver) => [p.inputProblem],
  ),
  definePipelineStep(
    "CopperGeometryExtractionSolver",
    routedStage(CopperGeometryExtractionSolver),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("TransientChannelSimulationPlanSolver")
        .value.map((plan) => plan.sections),
    ],
  ),
  definePipelineStep(
    "RouteFieldsSolver",
    routedStage(RouteFieldsSolver),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("CopperGeometryExtractionSolver")
        .value.map((sections, i) => ({
          geometry: sections.geometry,
          circuitJson: cloneCircuitJson(sections.circuitJson),
          scope: sections.copperScope,
          maskThicknessMm: sections.maskThicknessMm,
          materials: p.stageOutput("TransientChannelSimulationPlanSolver")
            .value[i].bindings.options.materials,
          artifactPrefix: p.stageOutput("TransientChannelSimulationPlanSolver")
            .value[i].sections.artifactPrefix,
        })),
    ],
  ),
  definePipelineStep(
    "RouteBindingsSolver",
    routedStage(RouteBindingsSolver),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("TransientChannelSimulationPlanSolver")
        .value.map((plan, i) => ({
          ...plan.bindings,
          copperScope: p.stageOutput("CopperGeometryExtractionSolver").value[i]
            .copperScope,
        })),
    ],
  ),
  definePipelineStep(
    "RouteNetworkSolver",
    routedStage(RouteNetworkSolver),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("TransientChannelSimulationPlanSolver")
        .value.map((plan, i) => ({
          simulationPcbTransientChannelSimulationId:
            plan.simulationPcbTransientChannelSimulationId,
          name: plan.name,
          geometry: p.stageOutput("CopperGeometryExtractionSolver").value[i]
            .geometry,
          extracted: p.stageOutput("RouteFieldsSolver").value[i],
          bindings: p.stageOutput("RouteBindingsSolver").value[i],
          materials: p.stageOutput("RouteFieldsSolver").value[i].materials,
          options: plan.bindings.options,
          warnings: plan.warnings,
          artifactPrefix: plan.sections.artifactPrefix,
        })),
    ],
  ),
  definePipelineStep(
    "RouteTransientSolver",
    routedStage(RouteTransientSolver),
    (p: RoutedPipelineSolver) => [
      p.stageOutput("RouteNetworkSolver").value.map((compiled, i) => ({
        compiled,
        artifactPrefix: p.stageOutput("TransientChannelSimulationPlanSolver")
          .value[i].sections.artifactPrefix,
        context: p.context,
      })),
    ],
  ),
] as const satisfies readonly PipelineStep<BaseSolver>[]

/** Output types keyed by their debugger stage names. */
interface RoutedStageOutputs {
  TransientChannelSimulationPlanSolver: Produced<
    readonly TransientChannelSimulationPlan[]
  >
  CopperGeometryExtractionSolver: RoutedStageOutput<CopperGeometry>
  RouteFieldsSolver: RoutedStageOutput<ExtractedRoutes>
  RouteBindingsSolver: RoutedStageOutput<RoutedBindings>
  RouteNetworkSolver: RoutedStageOutput<RoutedDeck>
  RouteTransientSolver: RoutedStageOutput<RoutedCapture>
}

/** A routed channel simulation’s compiled network and transient capture. */
export interface RoutedChannelSimulationView {
  id: TransientChannelSimulationPlan["simulationPcbTransientChannelSimulationId"]
  name: string
  compiled: RoutedDeck
  capture: RoutedCapture
}
/** Completed channel simulation results and files from every routed stage. */
export type RoutedInspection = Snapshot<{
  kind: "routed-inspection"
  channelSimulations: RoutedChannelSimulationView[]
  files: FileMap
}>

/** The circuit problem and the runtime capability used by one routed pipeline. */
interface RoutedPipelineInput {
  input: TransientChannelSimulationPlanInput
  context: SolverContext
}

/** The arguments used to reconstruct a routed pipeline. */
type RoutedPipelineConstructorParams = [RoutedPipelineInput]

/** A single static pipeline, from admission through sequential live transients. */
export class RoutedPipelineSolver extends BasePipelineSolver<TransientChannelSimulationPlanInput> {
  override MAX_ITERATIONS = Infinity
  override pipelineDef: PipelineStep<BaseSolver>[] = [...routedStages]
  private output?: RoutedInspection
  readonly context: SolverContext
  /** Preserve exact model bytes while keeping runtime capabilities outside immutable input. */
  constructor({ input, context }: RoutedPipelineInput) {
    super(capturePlanInput(input))
    this.context = context
  }
  /** Each completed row exposes its domain array in planning order. */
  stageOutput<K extends keyof RoutedStageOutputs>(
    name: K,
  ): RoutedStageOutputs[K] {
    const output = this.getStageOutput<RoutedStageOutputs[K]>(name)
    if (!output) throw new Error(`Incomplete stage ${name}`)
    return output
  }
  /** Fold each flat stage's artifacts once, preserving per-simulation values and paths. */
  override getOutput(): RoutedInspection {
    if (!this.solved) throw new Error("Routed pipeline is incomplete")
    if (this.output) return this.output
    let ledger = ArtifactLedger.empty()
    for (const stage of this.pipelineDef) {
      const output = this.getStageOutput<Produced<unknown>>(stage.solverName)!
      ledger = ledger.add(output.artifacts)
    }
    const plans = this.stageOutput("TransientChannelSimulationPlanSolver").value
    const compiled = this.stageOutput("RouteNetworkSolver").value
    const captures = this.stageOutput("RouteTransientSolver").value
    const channelSimulations = plans.map((plan, i) => ({
      id: plan.simulationPcbTransientChannelSimulationId,
      name: plan.name,
      compiled: compiled[i],
      capture: captures[i],
    }))
    ledger = ledger.add([
      rootScope("pipeline").json(
        "stages.json",
        routedStages.map((stage) => stage.solverName),
      ),
    ])
    this.output = snapshot({
      kind: "routed-inspection",
      channelSimulations,
      files: ledger.seal(),
    })
    return this.output
  }
  /** Exact source inputs plus the injected execution capability. */
  override getConstructorParams(): RoutedPipelineConstructorParams {
    return [{ input: this.inputProblem, context: this.context }]
  }
}
