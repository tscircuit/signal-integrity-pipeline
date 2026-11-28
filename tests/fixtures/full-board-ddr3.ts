import { readFile } from "node:fs/promises"
import {
  type Ddr3Options,
  withDdr3Signals,
} from "../../examples/routed/ddr3-signals"
import type { CircuitJson } from "../../src/board"

/** Node file loading delegates all TSX declarations and identity remapping to the browser-safe fixture. */
export async function fullBoardDdr3({
  path,
  options = {},
}: {
  path: string
  options?: Ddr3Options
}): Promise<CircuitJson> {
  const board: CircuitJson = JSON.parse(await readFile(path, "utf8"))
  return withDdr3Signals({ physicalRecords: board, options })
}
