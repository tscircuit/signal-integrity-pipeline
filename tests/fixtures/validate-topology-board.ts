import type { SourceNetId, SourcePortId } from "../../src/board"
import {
  signalTopology,
  validateSignalGraph,
} from "../../src/pipeline/topology"
import type { TopologyBoard } from "./topology-board"

/** Validate one rendered channel under the selected routing policy. */
export function validate({
  circuit,
  signal,
  rails = new Set(),
  allowUnroutedTraces = false,
}: TopologyBoard & {
  rails?: ReadonlySet<SourcePortId | SourceNetId>
  allowUnroutedTraces?: boolean
}): void {
  validateSignalGraph({
    circuit,
    topology: signalTopology({ circuit, rails }),
    signals: [signal],
    allowUnroutedTraces,
  })
}
