// Circuit JSON record admission (was schema.ts + circuit-schema.mjs). Validation never edits input.

import type { CircuitJson } from "circuit-json"
import * as base from "circuit-json"
import type { z } from "zod"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"

export type {
  CircuitJson,
  SimulationExperiment,
  SimulationIbisModel,
} from "circuit-json"

/** Copy a stage board for Circuit JSON libraries that require writable records. */
export function cloneCircuitJson(
  circuitJson: Snapshot<CircuitJson>,
): CircuitJson {
  return structuredClone([...circuitJson]) as CircuitJson
}

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
/** A present field that parsing would change. */
interface CanonicalDifference {
  path: string
  raw: unknown
  canonical: unknown
}

/** Compare values shared by the raw record and the schema output, ignoring omitted and stripped keys. */
function canonicalDifference({
  raw,
  canonical,
  path,
}: {
  raw: unknown
  canonical: unknown
  path: string
}): CanonicalDifference | undefined {
  if (Object.is(raw, canonical)) return
  if (
    raw === null ||
    canonical === null ||
    typeof raw !== "object" ||
    typeof canonical !== "object" ||
    Array.isArray(raw) !== Array.isArray(canonical)
  )
    return { path, raw, canonical }
  if (
    Array.isArray(raw) &&
    Array.isArray(canonical) &&
    raw.length !== canonical.length
  )
    return { path, raw, canonical }
  for (const [key, canonicalField] of Object.entries(canonical)) {
    if (!Object.hasOwn(raw, key)) continue
    const rawField: unknown = Reflect.get(raw, key)
    if (rawField === undefined) continue
    let field = key
    if (path) field = `${path}.${key}`
    const difference = canonicalDifference({
      raw: rawField,
      canonical: canonicalField,
      path: field,
    })
    if (difference) return difference
  }
}

/** Keep the parsed diagnostic and add the original value when a field was converted. */
function validateCanonicalRecord({
  record,
  canonical,
  type,
  id,
}: {
  record: unknown
  canonical: unknown
  type: unknown
  id: unknown
}): void {
  const difference = canonicalDifference({ raw: record, canonical, path: "" })
  if (!difference) return
  const { path, raw, canonical: expected } = difference
  fail(
    "circuit_schema",
    `${type} ${id}: ${path}: expected ${typeof expected} ${JSON.stringify(expected)} (canonical Circuit JSON), got ${JSON.stringify(raw)}`,
  )
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
    if (parsed.success) {
      const recordIdKey = `${type}_id`
      if (
        typeof parsed.data[recordIdKey] === "string" &&
        typeof record?.[recordIdKey] !== "string"
      )
        fail(
          "circuit_schema",
          `${type} ${id}: ${recordIdKey}: expected a Circuit JSON record ID`,
        )
      const name = record?.name
      validateCanonicalRecord({
        record,
        canonical: parsed.data,
        type,
        id: name ?? id,
      })
      continue
    }
    const issue = parsed.error.issues[0]
    let path = issue.path?.join(".") ?? ""
    if (path) path += ": "
    fail("circuit_schema", `${type} ${id}: ${path}${issue.message}`)
  }
}
