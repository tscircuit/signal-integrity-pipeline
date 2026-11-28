import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { SourcePortId } from "../../../src/board"

/** Display a physical pin without ambiguity across multiple components. */
export function qualifiedPort({
  db,
  port,
}: {
  db: CircuitJsonUtilObjects
  port: SourcePortId
}): string {
  const pin = db.source_port.get(port)
  if (!pin) return port
  const name = pin.name ?? port
  if (!pin.source_component_id) return name
  const component = db.source_component.get(pin.source_component_id)
  if (component?.name) return `${component.name}.${name}`
  return name
}

/** Format a number and suppress negative zero at the displayed precision. */
export function fixed({
  value,
  digits,
}: {
  value: number
  digits: number
}): string {
  const formatted = value.toFixed(digits)
  if (formatted.startsWith("-") && Number(formatted) === 0)
    return formatted.slice(1)
  return formatted
}
