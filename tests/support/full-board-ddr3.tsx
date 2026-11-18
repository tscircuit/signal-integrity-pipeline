import { readFile } from "node:fs/promises"
import {
  type Ddr3Options,
  withDdr3Signals,
} from "../../examples/routed/ddr3-signals"
import type { CircuitJson } from "../../src/board"

export type { Ddr3Options } from "../../examples/routed/ddr3-signals"
export { addrCmdPins } from "../../examples/routed/ddr3-signals"

/** Node file loading delegates all TSX declarations and identity remapping to the browser-safe fixture. */
export async function fullBoardDdr3(
  path: string,
  options: Ddr3Options = {},
): Promise<CircuitJson> {
  const board: CircuitJson = JSON.parse(await readFile(path, "utf8"))
  return withDdr3Signals(board, options)
}
