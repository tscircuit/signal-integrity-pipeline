import { cju } from "@tscircuit/circuit-json-util"
import "./extend-expect-circuit-snapshot"
import { expect } from "bun:test"
import type { PcbFabricationNoteText } from "circuit-json"
import type {
  CircuitJson,
  SimulationPcbDriverReceiverChannel,
} from "../../src/board"
import { Diagnostic } from "../../src/kernel/diagnostic"
import {
  signalTopology,
  validateSignalGraph,
} from "../../src/pipeline/topology"

/** Large enough to read on a 25 mm board, small enough for one diagnostic sentence. */
const VERDICT_FONT_SIZE = 0.5
/** Keeps the code and its message on separate lines. */
const VERDICT_LINE_SPACING = 0.8
/** Puts the first verdict line just inside the board's top edge, clear of the copper. */
const VERDICT_TOP_MARGIN_MM = 1
/** Green when the checks accept the board, red when they reject it. */
const ACCEPTED_COLOR = "rgb(80, 200, 120)"
const REJECTED_COLOR = "rgb(240, 90, 90)"

/** The single verdict line when the checks raise no diagnostic. */
const ACCEPTED = "ACCEPTED"

/** The verdict lines: `ACCEPTED`, or the diagnostic code and its message. */
type Verdict = string[]

/** Run the routed copper checks and describe their outcome. */
function verdict({
  circuit,
  signals,
  allowUnroutedTraces,
}: {
  circuit: CircuitJson
  signals: readonly SimulationPcbDriverReceiverChannel[]
  allowUnroutedTraces: boolean
}): Verdict {
  try {
    validateSignalGraph({
      circuit,
      topology: signalTopology({ circuit, rails: new Set() }),
      signals,
      allowUnroutedTraces,
    })
  } catch (error) {
    if (!(error instanceof Diagnostic)) throw error
    const text = error.message.slice(`${error.code}: `.length)
    return [error.code, text]
  }
  return [ACCEPTED]
}

/**
 * Snapshot the board with the routed copper verdict. The verdict text is drawn at
 * the top centre: horizontally centred, just inside the board's top edge.
 */
export function expectTopologySnapshot({
  circuit,
  signals,
  allowUnroutedTraces,
  testPath,
}: {
  circuit: CircuitJson
  signals: readonly SimulationPcbDriverReceiverChannel[]
  allowUnroutedTraces: boolean
  testPath: string
}): void {
  const board = cju([...circuit]).pcb_board.getWhere({})
  if (!board?.height)
    throw new Error("Expected the circuit to contain a sized pcb_board")
  const top = board.center.y + board.height / 2 - VERDICT_TOP_MARGIN_MM
  const lines = verdict({ circuit, signals, allowUnroutedTraces })
  let color = REJECTED_COLOR
  if (lines[0] === ACCEPTED) color = ACCEPTED_COLOR
  const notes = lines.map(
    (text, index): PcbFabricationNoteText => ({
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: `topology_verdict_${index}`,
      font: "tscircuit2024",
      font_size: VERDICT_FONT_SIZE,
      text,
      layer: "top",
      anchor_position: {
        x: board.center.x,
        y: top - index * VERDICT_LINE_SPACING,
      },
      anchor_alignment: "center",
      color,
    }),
  )
  expect([...circuit, ...notes]).toMatchPcbSnapshot(testPath)
}
