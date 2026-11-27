import { cju } from "@tscircuit/circuit-json-util"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { type Produced, rootScope, type Snapshot, snapshot } from "../kernel"
import type { CopperGeometryExtractionInput } from "./copper-geometry-extraction-input"
import {
  type CopperGeometryExtractionProgress,
  stepCopperGeometryExtraction,
} from "./copper-geometry-extraction-steps"
import { findPadContactWire } from "./copper-geometry-pad-contact"
import { getSoldermaskThicknessMm } from "./copper-geometry-soldermask"
import type { ExtractedCopper } from "./copper-geometry-types"
import { drawCopperGeometry } from "./copper-geometry-visual"
import type { CopperScope } from "./geometry/scope"
import { type CircuitJson, cloneCircuitJson } from "./schema"

/** Extracted copper geometry and its outer soldermask thickness when declared. */
export interface CopperGeometry {
  readonly circuitJson: Snapshot<CircuitJson>
  readonly copperScope: Snapshot<CopperScope>
  readonly geometry: Snapshot<ExtractedCopper>
  readonly maskThicknessMm: number | null
}

/** Require every input endpoint to contact modeled copper. */
function validateRequiredPorts({
  db,
  input,
  geometry,
}: {
  db: ReturnType<typeof cju>
  input: CopperGeometryExtractionInput
  geometry: ExtractedCopper
}): void {
  for (const sourcePortId of input.requiredSourcePortIds) {
    const pcbPort = db.pcb_port.getWhere({ source_port_id: sourcePortId })
    if (
      pcbPort?.layers.some((layer) =>
        findPadContactWire({
          geometry,
          layer,
          point: [pcbPort.x, pcbPort.y],
          pcbPortId: pcbPort.pcb_port_id,
        }),
      )
    )
      continue
    throw new Error(
      `required endpoint ${sourcePortId} has no physical wire or via contact`,
    )
  }
}

/** Check whether a planning input can be reused as an immutable input. */
function isDeeplyFrozen(input: unknown): boolean {
  if (input === null || typeof input !== "object") return true
  return Object.isFrozen(input) && Object.values(input).every(isDeeplyFrozen)
}

/** Read mutable caller inputs once without duplicating already frozen planning values. */
function captureInput(
  input: CopperGeometryExtractionInput,
): CopperGeometryExtractionInput {
  const captured = {
    ...input,
    requiredSourcePortIds: snapshot(input.requiredSourcePortIds),
  }
  if (!isDeeplyFrozen(input.circuitJson))
    captured.circuitJson = snapshot(input.circuitJson)
  if (!isDeeplyFrozen(input.copperScope))
    captured.copperScope = snapshot(input.copperScope)
  return Object.freeze(captured)
}

/** Extract one trace per step, then verify the required endpoint contacts. */
export class CopperGeometryExtractionSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private steps?: Generator<CopperGeometryExtractionProgress, ExtractedCopper>
  private circuit?: CircuitJson
  private output?: Produced<CopperGeometry>
  private readonly input: CopperGeometryExtractionInput

  /** Capture the board and its prepared copper scope. */
  constructor(input: CopperGeometryExtractionInput) {
    super()
    this.input = captureInput(input)
  }

  /** Report trace extraction counts, then publish the extracted copper geometry. */
  override _step(): void {
    this.circuit ??= cloneCircuitJson(this.input.circuitJson)
    this.steps ??= stepCopperGeometryExtraction({
      circuit: this.circuit,
      copperScope: this.input.copperScope,
    })
    const step = this.steps.next()
    if (!step.done) {
      this.stats = { ...step.value, sections: 0 }
      return
    }
    this.publishCopperGeometry({ circuit: this.circuit, geometry: step.value })
  }

  /** Validate final geometry and publish the immutable stage artifacts. */
  private publishCopperGeometry({
    circuit,
    geometry,
  }: {
    circuit: CircuitJson
    geometry: ExtractedCopper
  }): void {
    const db = cju([...circuit])
    const [stackup] = db.pcb_stackup.list()
    const maskThicknessMm = getSoldermaskThicknessMm(stackup.layers)
    validateRequiredPorts({ db, input: this.input, geometry })
    const { circuitJson, copperScope, artifactPrefix } = this.input
    const copperGeometry: CopperGeometry = Object.freeze({
      circuitJson,
      copperScope,
      geometry: snapshot(geometry),
      maskThicknessMm,
    })
    const artifactScope = rootScope("board").child(artifactPrefix)
    this.output = Object.freeze({
      value: copperGeometry,
      artifacts: snapshot([
        artifactScope.json(
          "copper-geometry-extraction.json",
          copperGeometry.geometry,
        ),
        artifactScope.json("scope.json", copperScope),
      ]),
    })
    this.stats = {
      ...this.stats,
      wires: geometry.wires.length,
      sections: geometry.sections.length,
    }
    this.solved = true
  }

  /** Completed immutable geometry. */
  override getOutput(): Produced<CopperGeometry> {
    if (!this.output)
      throw new Error("Copper geometry extraction is incomplete")
    return this.output
  }

  /** Draw the board and the extracted copper geometry. */
  override visualize(): GraphicsObject {
    return drawCopperGeometry({
      db: cju(cloneCircuitJson(this.input.circuitJson)),
      geometry: this.output?.value.geometry,
      error: this.error || undefined,
    })
  }

  /** Original problem, independent of work state. */
  override getConstructorParams(): ConstructorParameters<
    typeof CopperGeometryExtractionSolver
  > {
    return [this.input]
  }
}
