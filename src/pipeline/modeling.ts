import type { CopperScope, SourcePortId } from "../board"
import type { SimulationModeling, TraceContacts } from "../simulation"

/** Private channel simulation planning settings derived from the board and selected IBIS buffers. */
export type NumericalSettings = SimulationModeling & {
  traceContacts: TraceContacts[]
  channelReference: { sourcePortId: SourcePortId }
  copperScope: CopperScope
}
