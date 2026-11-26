import type { SourcePortId, SourceTraceId } from "../board"

/** One physical conductor removed from ideal connectivity for routed extraction. */
export interface TraceContacts {
  readonly sourceTraceId: SourceTraceId
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
}
