import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type CopperGeometryExtractionInput,
  renderPlanDrawing,
  type SimulationPcbTransientChannelSimulationId,
} from "../board"
import type { IbisSources } from "../buffers"
import {
  Diagnostic,
  type Produced,
  rootScope,
  sha256,
  snapshot,
} from "../kernel"
import type { RouteBindingsInput } from "../simulation"
import {
  capturePlanInput,
  type TransientChannelSimulationPlanInput,
  type ValidatedBoard,
  type ValidatedChannelSimulation,
  validatePlanningBoard,
} from "./plan/input"
import { buildPlanVisualScene, type FailedPlanAttempt } from "./plan/visual"
import { resolveReceiverTracePaths } from "./resolve-receiver-paths"
import { compareNames } from "./signal-names"
import { prepareChannelSimulation } from "./signals"

/** Planning starts with the base route mesh resolution. */
const BASE_REFINEMENT = 1

/** Planning has no warnings before the downstream compilation stages. */
const PLAN_WARNINGS: readonly string[] = Object.freeze([])

/** Frozen section and binding inputs for one planned transient channel simulation. */
export interface TransientChannelSimulationPlan {
  readonly simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  readonly name: string
  readonly sections: CopperGeometryExtractionInput
  readonly bindings: RouteBindingsInput
  readonly warnings: readonly string[]
}

/** The completed channel plans and their plan manifest. */
type PlanOutput = Produced<readonly TransientChannelSimulationPlan[]>

/** Lower the validated declaration into sectioning and binding inputs. */
function buildChannelPlan({
  input,
  nearbyGapMm,
  validatedChannelSimulation,
}: {
  input: TransientChannelSimulationPlanInput
  nearbyGapMm: number
  validatedChannelSimulation: ValidatedChannelSimulation
}): TransientChannelSimulationPlan {
  const { channelSimulation, simulationPcbTransientChannelSimulationId } =
    validatedChannelSimulation
  const prepared = prepareChannelSimulation({
    boardCircuitJson: input.circuitJson,
    sources: input.ibisSources,
    ...validatedChannelSimulation,
    nearbyGapMm,
  })
  const artifactPrefix = `channelSimulations/${simulationPcbTransientChannelSimulationId}`
  const circuitJson = snapshot(prepared.circuit)
  const modeling = snapshot(prepared.settings)
  const { traceContacts } = modeling
  const requiredSourcePortIds = Object.freeze([
    ...new Set(
      traceContacts.flatMap(({ fromSourcePortId, toSourcePortId }) => [
        fromSourcePortId,
        toSourcePortId,
      ]),
    ),
  ])
  const receiverPaths = snapshot(
    resolveReceiverTracePaths({ prepared, traceContacts }),
  )
  return Object.freeze({
    simulationPcbTransientChannelSimulationId,
    name: channelSimulation.name ?? simulationPcbTransientChannelSimulationId,
    warnings: PLAN_WARNINGS,
    sections: Object.freeze({
      circuitJson,
      copperScope: modeling.copperScope,
      requiredSourcePortIds,
      referenceSourcePortId: modeling.channelReference.sourcePortId,
      artifactPrefix,
    }),
    bindings: Object.freeze({
      circuitJson,
      receiverPaths,
      traceContacts,
      modeling,
      controls: snapshot(prepared.controls),
      ibisSources: input.ibisSources,
      options: Object.freeze({
        fastestEdgeSeconds: prepared.fastestEdgeSeconds,
        refinement: BASE_REFINEMENT,
        stepSeconds: prepared.stepSeconds,
        durationSeconds: prepared.durationSeconds,
      }),
      artifactPrefix,
    }),
  })
}

/** Publish the manifest and the completed plans as one immutable output. */
function finalizePlans({
  channelSimulationPlans,
  ibisSources,
}: {
  channelSimulationPlans: readonly TransientChannelSimulationPlan[]
  ibisSources: Readonly<IbisSources>
}): PlanOutput {
  const channelSimulations = channelSimulationPlans.map(
    ({ simulationPcbTransientChannelSimulationId, name, warnings }) => ({
      simulationPcbTransientChannelSimulationId,
      name,
      warnings,
    }),
  )
  const assetPaths = Object.keys(ibisSources).sort((a, b) =>
    compareNames({ a, b }),
  )
  const models = Object.fromEntries(
    assetPaths.map((assetPath) => [assetPath, sha256(ibisSources[assetPath])]),
  )
  const artifact = rootScope("pipeline").json(
    "transient-channel-simulation-plan.json",
    {
      channelSimulations,
      models,
    },
  )
  return Object.freeze({
    value: Object.freeze([...channelSimulationPlans]),
    artifacts: Object.freeze([Object.freeze(artifact)]),
  })
}

/** The plan solver performs exactly one channel simulation's lowering per step. */
export class TransientChannelSimulationPlanSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private readonly input: TransientChannelSimulationPlanInput
  private validatedBoard?: ValidatedBoard
  private readonly channelSimulationPlans: TransientChannelSimulationPlan[] = []
  private totalChannelPcbTraceCount = 0
  private output?: PlanOutput
  private failedAttempt?: FailedPlanAttempt
  /** Capture a single board and model version for the whole planning run. */
  constructor(input: TransientChannelSimulationPlanInput) {
    super()
    this.input = capturePlanInput(input)
  }
  /** Prepare the next channel simulation and finalize once all plans are ready. */
  override _step(): void {
    try {
      this.validatedBoard ??= validatePlanningBoard(this.input)
    } catch (error) {
      this.failedAttempt = { error }
      throw error
    }
    const { channelSimulations, nearbyGapMm } = this.validatedBoard
    const validatedChannelSimulation =
      channelSimulations[this.channelSimulationPlans.length]
    if (validatedChannelSimulation) {
      try {
        const plan = buildChannelPlan({
          input: this.input,
          nearbyGapMm,
          validatedChannelSimulation,
        })
        this.channelSimulationPlans.push(plan)
        this.totalChannelPcbTraceCount +=
          plan.sections.copperScope.channelPcbTraceIds.length
      } catch (error) {
        this.failedAttempt = {
          channelSimulation: validatedChannelSimulation.channelSimulation,
          error,
        }
        throw error
      }
    }
    const channelSimulationCount = this.channelSimulationPlans.length
    this.stats = {
      channelSimulationCount,
      totalChannelPcbTraceCount: this.totalChannelPcbTraceCount,
    }
    if (channelSimulationCount !== channelSimulations.length) return
    try {
      this.output = finalizePlans({
        channelSimulationPlans: this.channelSimulationPlans,
        ibisSources: this.input.ibisSources,
      })
    } catch (error) {
      this.failedAttempt = { error }
      throw error
    }
    this.solved = true
  }
  /** No partially planned channel simulation list escapes. */
  override getOutput(): PlanOutput {
    if (!this.output)
      throw new Error("Transient channel simulation plan is incomplete")
    return this.output
  }
  /** The input captured at construction. */
  override getConstructorParams(): ConstructorParameters<
    typeof TransientChannelSimulationPlanSolver
  > {
    return [
      Object.freeze({
        ...this.input,
        circuitJson: structuredClone(this.input.circuitJson),
      }),
    ]
  }
  /** Inspect the most recent attempted channel simulation and its board. */
  override visualize(): GraphicsObject {
    const error = this.failedAttempt?.error
    let circuitJson = this.input.circuitJson
    if (error instanceof Diagnostic && error.code === "circuit_schema")
      circuitJson = []
    return renderPlanDrawing(
      buildPlanVisualScene({
        circuitJson,
        plan: this.channelSimulationPlans.at(-1),
        failed: this.failedAttempt,
        error: this.error || null,
        solved: this.solved,
      }),
    )
  }
}
