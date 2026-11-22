import type { PipelineStep } from "@tscircuit/solver-utils"
import {
  BasePipelineSolver,
  type BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import { type RoutedSections, RouteSectionsSolver } from "../board"
import { type ExtractedRoutes, RouteFieldsSolver } from "../extraction"
import {
  ArtifactLedger,
  type FileMap,
  type Produced,
  rootScope,
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
  RoutedAdmissionSolver,
  type RoutedChannelSimulationPlan,
  type RoutedProblem,
} from "./routed-admission"
import { routedStage } from "./routed-stage"

/** All six rows exist before the first step; every stage drains all admitted channel simulations in order. */
export const routedStages = [
  definePipelineStep(
    "RoutedAdmissionSolver",
    RoutedAdmissionSolver,
    (p: RoutedPipelineSolver) => [p.inputProblem],
  ),
  definePipelineStep(
    "RouteSectionsSolver",
    routedStage(RouteSectionsSolver),
    (p: RoutedPipelineSolver) => [
      p.stageOutput("RoutedAdmissionSolver").value.map((plan) => plan.sections),
    ],
  ),
  definePipelineStep(
    "RouteFieldsSolver",
    routedStage(RouteFieldsSolver),
    (p: RoutedPipelineSolver) => [
      p.stageOutput("RouteSectionsSolver").value.map((sections, i) => ({
        geometry: sections.geometry,
        circuitJson: sections.circuitJson,
        scope: sections.scope,
        maskThicknessMm: sections.maskThicknessMm,
        materials: p.stageOutput("RoutedAdmissionSolver").value[i].bindings
          .options.materials,
        artifactPrefix: p.stageOutput("RoutedAdmissionSolver").value[i].sections
          .artifactPrefix,
      })),
    ],
  ),
  definePipelineStep(
    "RouteBindingsSolver",
    routedStage(RouteBindingsSolver),
    (p: RoutedPipelineSolver) => [
      p.stageOutput("RoutedAdmissionSolver").value.map((plan, i) => ({
        ...plan.bindings,
        scope: p.stageOutput("RouteSectionsSolver").value[i].scope,
      })),
    ],
  ),
  definePipelineStep(
    "RouteNetworkSolver",
    routedStage(RouteNetworkSolver),
    (p: RoutedPipelineSolver) => [
      p.stageOutput("RoutedAdmissionSolver").value.map((plan, i) => ({
        simulationPcbTransientChannelSimulationId: plan.id,
        name: plan.name,
        geometry: p.stageOutput("RouteSectionsSolver").value[i].geometry,
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
        artifactPrefix: p.stageOutput("RoutedAdmissionSolver").value[i].sections
          .artifactPrefix,
        context: p.context,
      })),
    ],
  ),
] as const satisfies readonly PipelineStep<BaseSolver>[]

/** Output types keyed by their debugger stage names. */
interface RoutedStageOutputs {
  RoutedAdmissionSolver: Produced<RoutedChannelSimulationPlan[]>
  RouteSectionsSolver: Produced<RoutedSections[]>
  RouteFieldsSolver: Produced<ExtractedRoutes[]>
  RouteBindingsSolver: Produced<RoutedBindings[]>
  RouteNetworkSolver: Produced<RoutedDeck[]>
  RouteTransientSolver: Produced<RoutedCapture[]>
}

/** A routed channel simulation’s compiled network and transient capture. */
export interface RoutedChannelSimulationView {
  id: RoutedChannelSimulationPlan["id"]
  name: string
  compiled: RoutedDeck
  capture: RoutedCapture
}
/** Completed channel simulation results and files from every routed stage. */
export interface RoutedInspection {
  kind: "routed-inspection"
  channelSimulations: RoutedChannelSimulationView[]
  files: FileMap
}

/** The circuit problem and the runtime capability used by one routed pipeline. */
interface RoutedPipelineInput {
  input: RoutedProblem
  context: SolverContext
}

/** The arguments used to reconstruct a routed pipeline. */
type RoutedPipelineConstructorParams = [RoutedPipelineInput]

/** A single static pipeline, from admission through sequential live transients. */
export class RoutedPipelineSolver extends BasePipelineSolver<RoutedProblem> {
  override pipelineDef: PipelineStep<BaseSolver>[] = [...routedStages]
  private output?: RoutedInspection
  readonly context: SolverContext
  /** Preserve exact model bytes while keeping runtime capabilities outside immutable input. */
  constructor({ input, context }: RoutedPipelineInput) {
    const ibisSources = Object.fromEntries(
      Object.entries(input.ibisSources).map(([name, bytes]) => {
        if (typeof bytes === "string") return [name, bytes]
        return [
          name,
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes,
          ),
        ]
      }),
    )
    super(snapshot({ ...input, ibisSources }))
    this.context = context
  }
  /** Each completed row exposes its domain array in admission order. */
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
    const plans = this.stageOutput("RoutedAdmissionSolver").value
    const compiled = this.stageOutput("RouteNetworkSolver").value
    const captures = this.stageOutput("RouteTransientSolver").value
    const channelSimulations = plans.map((plan, i) => ({
      id: plan.id,
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
