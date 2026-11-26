import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import type { CircuitJson } from "./schema"

/** The board, copper scope and required ports passed to route sectioning. */
export interface CopperGeometryExtractionInput {
  readonly circuitJson: Snapshot<CircuitJson>
  readonly copperScope: Snapshot<CopperScope>
  readonly requiredSourcePortIds: readonly SourcePortId[]
  readonly referenceSourcePortId: SourcePortId
  readonly artifactPrefix: string
}
