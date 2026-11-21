// Was src/stimulus.ts.
import { fail, type SimulationCode } from "./diagnostics"

/** Maximum number of bits accepted in a serialized stimulus pattern. */
export const MAX_STIMULUS_BITS = 65_536

/** Public. Normalizes a transmission pattern to a '0'/'1' string (<= 65536 bits). */
export function transmittedBits({
  value,
  code = "stimulus_pattern",
}: {
  value: unknown
  code?: SimulationCode
}): string {
  if (
    (Array.isArray(value) || typeof value === "string") &&
    value.length > MAX_STIMULUS_BITS
  )
    fail(
      code,
      `Transmission patterns must contain at most ${MAX_STIMULUS_BITS} bits`,
    )
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
