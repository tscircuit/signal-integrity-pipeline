// Circuit JSON record admission (was schema.ts + circuit-schema.mjs). Validation never edits input.

import * as base from "circuit-json"
import type { z } from "zod"
import { fail } from "./diagnostics"

export type {
  CircuitJson,
  LayerRef,
  SimulationExperiment,
  SimulationIbisModel,
  SourceTrace,
} from "circuit-json"

/** Picks the circuit-json schema by record type, or by ftype for source components. */
export function recordSchema(record: {
  type: string
  ftype?: string
}): z.ZodTypeAny | undefined {
  let schemaName = record.type
  if (record.type === "source_component") schemaName = `source_${record.ftype}`
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: Record types select their registered schema at runtime.
  return base[schemaName as keyof typeof base] as z.ZodTypeAny | undefined
}
/** Select the registered record schema directly, avoiding a union diagnostic
 * containing hundreds of unrelated alternatives. Validation never edits input. */
export function validateCircuitRecords(records: unknown): void {
  if (!Array.isArray(records))
    fail("circuit_schema", "Expected a Circuit JSON record array")
  for (const record of records as Array<
    Record<string, unknown> | null | undefined
  >) {
    const type = record?.type
    const id = record?.[`${type}_id`] ?? record?.name ?? "(unnamed)"
    let schema: Partial<z.ZodTypeAny> | undefined
    if (typeof type === "string") {
      schema = recordSchema(
        record as {
          type: string
          ftype?: string
        },
      )
    }
    if (!schema?.safeParse)
      fail(
        "circuit_schema",
        `${type ?? "(missing type)"} ${id}: no registered record schema`,
      )
    const parsed = schema.safeParse(record)
    if (parsed.success) continue
    const issue = parsed.error.issues[0]
    let path = issue.path?.join(".") ?? ""
    if (path) path += ": "
    fail("circuit_schema", `${type} ${id}: ${path}${issue.message}`)
  }
}
