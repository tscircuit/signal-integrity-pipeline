/** The save directive, transient analysis and deck terminator in SPICE order. */
type RoutedControlLines = [save: string, transient: string, end: string]

/** A single declarative transient deck is consumed by local native batch ngspice. */
export function routedControl({
  saved,
  stepSeconds,
  durationSeconds,
}: {
  saved: string
  stepSeconds: number
  durationSeconds: number
}): RoutedControlLines {
  return [
    `.save ${saved}`,
    `.tran ${stepSeconds} ${durationSeconds} 0 ${stepSeconds}`,
    ".end",
  ]
}
