import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import { cloneCircuitJson } from "../board"
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
      circuitJson: snapshot(this.input.circuitJson),
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
}
