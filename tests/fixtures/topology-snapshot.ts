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
/** Drops the verdict below the fixtures' copper, which runs through the board centre. */
const VERDICT_OFFSET_MM = 2.5
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

/** Snapshot the board with the routed copper verdict written at its centre. */
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
  const board = circuit.find((record) => record.type === "pcb_board")
  if (!board) throw new Error("Expected the circuit to contain a pcb_board")
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
        y: board.center.y - VERDICT_OFFSET_MM - index * VERDICT_LINE_SPACING,
      },
      anchor_alignment: "center",
      color,
    }),
  )
  expect([...circuit, ...notes]).toMatchPcbSnapshot(testPath)
}
