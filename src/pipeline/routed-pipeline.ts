import type { PipelineStep } from "@tscircuit/solver-utils"
import {
  BasePipelineSolver,
  type BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type CopperGeometry,
  CopperGeometryExtractionStage,
  getBoardBounds,
  routeBoardDrawing,
  routeLengths,
  routeStrip,
  routeText,
  routeTones,
  routeView,
  withRouteDrawing,
} from "../board"
import {
  ArtifactLedger,
  type FileMap,
  type Produced,
  rootScope,
  type Snapshot,
  snapshot,
} from "../kernel"
import { type TransmissionLineRlgc, TransmissionLineRlgcSolver } from "../rlgc"
import {
  RouteBindingsSolver,
  type RoutedBindings,
  type RoutedCapture,
  type RoutedDeck,
  RouteNetworkSolver,
  RouteTransientSolver,
  receiverThreshold,
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
    routedStage(CopperGeometryExtractionStage),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("TransientChannelSimulationPlanSolver")
        .value.map((plan) => plan.sections),
    ],
  ),
  definePipelineStep(
    "TransmissionLineRlgcSolver",
    routedStage(TransmissionLineRlgcSolver),
    (p: RoutedPipelineSolver) => [
      p
        .stageOutput("CopperGeometryExtractionSolver")
        .value.map((copperGeometry, i) => ({
          copperGeometry,
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
          extracted: p.stageOutput("TransmissionLineRlgcSolver").value[i],
          bindings: p.stageOutput("RouteBindingsSolver").value[i],
          materials: p.stageOutput("TransmissionLineRlgcSolver").value[i]
            .materials,
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
        board: p.stageOutput("CopperGeometryExtractionSolver").value[i],
        artifactPrefix: p.stageOutput("TransientChannelSimulationPlanSolver")
          .value[i].sections.artifactPrefix,
        context: p.context,
        threshold: receiverThreshold({
          ibisSources: p.inputProblem.ibisSources,
          models: p.stageOutput("RouteBindingsSolver").value[i].models,
          receivers: new Set(
            p
              .stageOutput("RouteBindingsSolver")
              .value[i].receiverPaths.map(
                ({ toSourcePortId }) => toSourcePortId,
              ),
          ),
        }),
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
  TransmissionLineRlgcSolver: RoutedStageOutput<TransmissionLineRlgc>
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
  /** Inspect retained output or the incoming stage's immutable input, without executing work. */
  visualizeStage(number: number): GraphicsObject {
    if (number === 0) return this.initialVisualize()
    const definition = this.pipelineDef[number - 1]
    let solver = this.getSolver(definition.solverName)
    if (!solver && number - 1 <= this.currentPipelineStageIndex) {
      solver = new definition.solverClass(
        ...definition.getConstructorParams(this),
      )
    }
    const plans = this.getStageOutput<
      Produced<TransientChannelSimulationPlan[]>
    >("TransientChannelSimulationPlanSolver")?.value
    const circuit = this.inputProblem.circuitJson
    if (plans && !plans.length) {
      // No channels were planned: the whole board with one quiet line, the same in every stage.
      const drawing = routeBoardDrawing({ circuit, scope: undefined })
      const board = getBoardBounds(circuit)
      drawing.texts!.push(
        routeText({
          x: (board.minX + board.maxX) / 2,
          y: (board.minY + board.maxY) / 2,
          text: "No transient channel simulations admitted",
          color: routeTones.quiet,
          size: (board.maxX - board.minX) / 40,
        }),
      )
      return drawing
    }
    if (solver) return solver.visualize()
    // A stage that cannot be built yet shows the selected copper and its unrolled lengths in neutral grey.
    const scope = plans?.[0]?.sections.copperScope
    let drawing = routeBoardDrawing({
      circuit,
      scope,
      color: () => routeTones.copper,
    })
    if (!scope) return drawing
    const view = routeView({ circuit, scope })
    drawing = withRouteDrawing({
      drawing: drawing,
      overlay: routeStrip({
        pane: view.pane,
        rows: routeLengths({ circuit, view }).map((row) => ({
          ...row,
          parts: [{ from: 0, to: row.length, color: routeTones.copper }],
        })),
      }),
    })
    return drawing
  }
  /** Stage boundaries show the incoming input immediately, before its first step. */
  override visualize(): GraphicsObject {
    if (this.iterations === 0) return this.visualizeStage(0)
    return this.visualizeStage(
      Math.min(this.currentPipelineStageIndex + 1, this.pipelineDef.length),
    )
  }
  /** Before any stage has run there is nothing to overlay, so the whole board shows. */
  override initialVisualize(): GraphicsObject {
    return routeBoardDrawing({
      circuit: this.inputProblem.circuitJson,
      scope: undefined,
    })
  }
  /** A completed pipeline follows the final transient; earlier stages keep their own drawings. */
  override finalVisualize(): GraphicsObject {
    return (
      this.getSolver("RouteTransientSolver")?.visualize() ??
      this.initialVisualize()
    )
  }
}
