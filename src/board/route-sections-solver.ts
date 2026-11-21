import { BaseSolver } from "@tscircuit/solver-utils"
import { type Produced, rootScope, snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import {
  routeContactFrame,
  routeSectionSteps,
  type SectionGeometry,
} from "./route-sections"
import type { CircuitJson } from "./schema"

/** The board, selected copper and required ports passed to route sectioning. */
export interface RouteSectionsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  requiredSourcePortIds: SourcePortId[]
  artifactPrefix: string
}
/** Completed route geometry and its outer soldermask thickness when declared. */
export interface RoutedSections {
  circuitJson: CircuitJson
  scope: CopperScope
  geometry: SectionGeometry
  maskThicknessMm: number | null
}

/** Segment one real route per step, then admit selected endpoint contacts. */
export class RouteSectionsSolver extends BaseSolver {
  private steps?: Generator<SectionGeometry, SectionGeometry>
  private output?: Produced<RoutedSections>
  /** Capture the board and its prepared copper scope. */
  constructor(private readonly input: RouteSectionsInput) {
    super()
  }
  /** Each yield has performed one route's segmentation; the final pass slices actual references. */
  override _step(): void {
    this.steps ??= routeSectionSteps({
      circuit: this.input.circuitJson,
      scope: this.input.scope,
    })
    const result = this.steps.next()
    const geometry = result.value
    this.stats = {
      routes: Math.min(this.iterations, this.input.scope.pcbTraceIds.length),
      wires: geometry.wires.length,
      slices: geometry.slices.length,
    }
    if (!result.done) return

    const { circuitJson, requiredSourcePortIds, artifactPrefix } = this.input
    const [stackup] = circuitJson.filter(
      (record) => record.type === "pcb_stackup",
    )
    const masks = stackup.layers.filter(
      (layer) => layer.layer_type === "soldermask",
    )
    if (new Set(masks.map((layer) => layer.thickness)).size > 1) {
      throw new Error(
        "Asymmetric soldermask thickness requires separate outer-layer material profiles",
      )
    }
    for (const id of requiredSourcePortIds) {
      const port = circuitJson.find(
        (record) => record.type === "pcb_port" && record.source_port_id === id,
      )
      if (
        port?.type === "pcb_port" &&
        port.layers.some((layer) =>
          routeContactFrame({
            geometry,
            scope: this.input.scope,
            layer,
            point: [port.x, port.y],
          }),
        )
      )
        continue
      throw new Error(
        `selected endpoint ${id} has no physical wire or via contact`,
      )
    }

    const value = snapshot<RoutedSections>({
      circuitJson,
      scope: this.input.scope,
      geometry,
      maskThicknessMm: masks[0]?.thickness ?? null,
    })
    const scope = rootScope("board").child(artifactPrefix)
    this.output = {
      value,
      artifacts: [
        scope.json("geometry.json", value.geometry),
        scope.json("scope.json", value.scope),
      ],
    }
    this.solved = true
  }
  /** Completed immutable geometry only. */
  override getOutput(): Produced<RoutedSections> {
    if (!this.output) throw new Error("Route sections are incomplete")
    return this.output
  }
  /** Original problem, independent of work state. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteSectionsSolver
  > {
    return [this.input]
  }
}
