import { isQuiet, type SimulationPcbDriverReceiverChannel } from '../board'

/** Finite capture after startup; quiet-only captures use 32 of the slowest UI. */
export function recordingTime(signals: SimulationPcbDriverReceiverChannel[]): { duration: number; gate: number } {
  const switching = signals.filter(signal => !isQuiet(signal))
  if (!switching.length) {
    const ui = Math.max(...signals.map(signal => 1 / signal.bit_rate_bps))
    return { duration: 32 * ui, gate: 16 * ui }
  }
  const ui = Math.max(...switching.map(signal => 1 / signal.bit_rate_bps))
  const gate = Math.max(...switching.map(signal => signal.offset_ms / 1000 + 16 / signal.bit_rate_bps))
  return { duration: gate + 128 * ui, gate }
}
/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!)
  const right = Array.from(b, c => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}
