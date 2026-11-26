// Was src/stimulus.ts.
import { fail, type SimulationCode } from "./diagnostics"

/** Public. Normalizes a transmission pattern to a '0'/'1' string. */
export function transmittedBits({
  value,
  code = "stimulus_pattern",
}: {
  value: unknown
  code?: SimulationCode
}): string {
  if (
    Array.isArray(value) &&
    value.length &&
    Array.from(value).every((bit) => bit === 0 || bit === 1)
  ) {
    return value.join("")
  }
  if (
    typeof value === "string" &&
    value.length > 0 &&
    Array.from(value).every((bit) => bit === "0" || bit === "1")
  ) {
    return value
  }
  fail(
    code,
    "A nonempty binary string or array of numeric 0/1 bits is required",
  )
}
