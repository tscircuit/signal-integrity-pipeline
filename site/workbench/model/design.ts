import type { CircuitJson } from "../../../src/board"
import { listChannelSimulations } from "../../../src/pipeline/signals"
import { inspectorBoard } from "../../channel-inspector/geometry"
import type { InspectorInput } from "../../channel-inspector/input"

/** Refresh the inspector's derived view after an immutable design edit. */
export function updateDesign({
  input,
  circuit,
}: {
  input: InspectorInput
  circuit: CircuitJson
}): InspectorInput {
  return {
    ...input,
    circuit,
    simulations: listChannelSimulations(circuit),
    board: inspectorBoard(circuit),
  }
}
