import { simulation } from "@tscircuit/core"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import { formatSpiceVectors } from "../../src/observation"
import { RoutedPipelineSolver } from "../../src/pipeline"
import type { SolverContext } from "../../src/solver"
import { renderCoreSignals } from "../support/core-render"
import {
  savedVectors,
  transientDurationSeconds,
  voltageNames,
} from "./routed-deck"

import { routedVisualIbis } from "./routed-visual-fixture"

/** The simulation plan shown by the two-trace SVG and stage-one PNG. */
export const twoTracePlanCaption =
  "Two parallel traces carry DATA from TX0 to RX0 and VICTIM from TX1 to RX1. This test checks that both paths pass with their nearby copper included."

/** A solved pipeline over the synthetic routed board. */
interface RoutedVisualFixture {
  root: RoutedPipelineSolver
}

const fixtures = new Map<number, Promise<RoutedVisualFixture>>()

/** Use the same channel rate and duration for both visual fixture variants. */
const FIXTURE_BIT_RATE = "400Mbps"
const FIXTURE_DURATION_SECONDS = 4e-9
/** Include both traces in the synthetic field extraction. */
const FIXTURE_SCOPE_DISTANCE_MM = 1
/** Swap the board's single simulation declaration for the two-channel simulation fixture. */
function twoChannelSimulationBoard(
  board: ReturnType<typeof TwoTraceBoard>,
): ReturnType<typeof TwoTraceBoard> {
  const children = React.Children.toArray(board.props.children).filter(
    (child) =>
      !React.isValidElement(child) ||
      child.type !== simulation.pcbtransientchannelsimulation,
  )
  const channelSimulations = [0, 1].map((i) => (
    <simulation.pcbtransientchannelsimulation
      key={i}
      name={`BLOCK${i}`}
      bitRate={FIXTURE_BIT_RATE}
      duration={FIXTURE_DURATION_SECONDS}
      aggressorPattern="0"
    >
      <simulation.pcbdriverreceiverchannel
        name={`DATA${i}`}
        driverRef={`.TX${i} > .Y`}
        receiverRef={`.RX${i} > .A`}
        pattern="01"
      />
    </simulation.pcbtransientchannelsimulation>
  ))
  return React.cloneElement(board, {}, ...children, ...channelSimulations)
}

/** Return one of the synthetic voltage series shown in the drawings. */
function fixtureVoltage(probe: number): number[] {
  if (probe === 0) return [0, 0.8, 2.1, 1.5, 1.5]
  if (probe === 1) return [0, 0.1, -0.5, 0.05, 0]
  return [3.3, 3.3, 3.3, 3.3, 3.3]
}

// Synthetic engine IO for drawing only.
const context: SolverContext = {
  progress: (): void => undefined,
  runSolver: async (request) => {
    const deck = request.files["simulation.cir"]
    const durationSeconds = transientDurationSeconds(deck)
    const names = voltageNames(savedVectors(deck))
    const times = [
      0,
      durationSeconds * 0.2,
      durationSeconds * 0.21,
      durationSeconds * 0.25,
      durationSeconds,
    ]
    const raw = formatSpiceVectors([
      { name: "time", type: "time", values: times },
      ...names.map((name, i) => ({
        name: `v(${name})`,
        type: "voltage",
        values: fixtureVoltage(i),
      })),
    ])
    return { stdout: "", stderr: "", files: { "waveform.raw": raw } }
  },
}

/** Render and solve the visual fixture with original drawing-only model tables. */
async function solveVisualFixture(
  channelSimulations: number,
): Promise<RoutedVisualFixture> {
  const board = TwoTraceBoard({
    "bit-rate": FIXTURE_BIT_RATE,
    "duration-seconds": FIXTURE_DURATION_SECONDS,
  })
  let tree = board
  if (channelSimulations !== 1) tree = twoChannelSimulationBoard(board)
  const circuitJson = await renderCoreSignals(tree)
  const root = new RoutedPipelineSolver({
    input: {
      circuitJson,
      ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
      nearbyGapMm: FIXTURE_SCOPE_DISTANCE_MM,
    },
    context,
  })
  await root.solveAsync()
  return { root }
}

/** Use the single-channel simulation fixture unless a test requests a different count. */
const DEFAULT_VISUAL_CHANNEL_SIMULATION_COUNT = 1

/** Solve real TwoTraceBoard TSX once per channel simulation count in each test file. */
export function routedVisualFixture(
  channelSimulations: number = DEFAULT_VISUAL_CHANNEL_SIMULATION_COUNT,
): Promise<RoutedVisualFixture> {
  const existing = fixtures.get(channelSimulations)
  if (existing) return existing
  const fixture = solveVisualFixture(channelSimulations)
  fixtures.set(channelSimulations, fixture)
  return fixture
}

export { assertPlanDrawingSnapshot } from "./plan-drawing-snapshot"
