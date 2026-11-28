import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import type { CircuitJson } from "./schema"

/** The board, copper scope and required ports for copper geometry extraction. */
export interface CopperGeometryExtractionInput {
  readonly circuitJson: Snapshot<CircuitJson>
  readonly copperScope: Snapshot<CopperScope>
  readonly requiredSourcePortIds: readonly SourcePortId[]
  readonly artifactPrefix: string
}
