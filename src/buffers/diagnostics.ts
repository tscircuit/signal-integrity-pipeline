import { type DiagnosticInit, diagnostics } from "../kernel"

/** Diagnostics for IBIS inspection, asset admission and conversion. */
const raise = diagnostics("buffers", [
  "converter_version",
  "vendor_hash",
  "ibis_asset",
  "ibis_asset_missing",
  "ibis_capability_unsupported",
  "ibis_component_missing",
  "ibis_edge_duration_missing",
  "ibis_edge_not_driving",
  "ibis_model_choice",
  "ibis_pin_bound_twice",
  "ibis_pin_missing",
  "ibis_reference_ambiguous",
  "ibis_reference_short",
  "ibis_reference_voltage_missing",
  "file_path",
] as const)
export type BuffersCode = Parameters<typeof raise>[0]
/** Declared as a function so `never` narrows control flow at call sites. */
export function fail(
  code: BuffersCode,
  text: string,
  init?: DiagnosticInit,
): never {
  return raise(code, text, init)
}
