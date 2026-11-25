import { fileURLToPath } from "node:url"

/** Checked-in export of the AM3352 DDR3 board, without vendor IBIS data. */
export const am3352BoardFile = fileURLToPath(
  new URL("./board.circuit.json", import.meta.url),
)

/** Use the same physical board for the fixture server and offline examples. */
export const ddr3BoardFile = process.env.SI_DDR3_BOARD ?? am3352BoardFile
