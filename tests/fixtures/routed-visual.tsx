import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { simulation } from "@tscircuit/core"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
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
/** Round drawing coordinates at the precision shared by the supported JavaScript engines. */
const SNAPSHOT_DECIMAL_PLACES = 6
/** Export the atlas at a fixed size for snapshot comparison. */
const SNAPSHOT_WIDTH = 1100
const SNAPSHOT_HEIGHT = 800

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

/** Compare actual exported SVG, including explicit text and fills; snapshots contain no vendor data. */
export function assertPlanDrawingSnapshot({
  drawing,
  module,
  name,
}: {
  drawing: GraphicsObject
  module: string
  name: string
}): void {
  const path = join(
    import.meta.dirname,
    "..",
    module,
    "__snapshots__",
    `${name}.snap.svg`,
  )
  // Ignore sub-micro-atlas-unit V8/JavaScriptCore rounding in display coordinates only.
  const serialized = JSON.stringify(drawing, (_key, value) => {
    if (typeof value === "number")
      return Number(value.toFixed(SNAPSHOT_DECIMAL_PLACES))
    return value
  })
  const normalized: GraphicsObject = JSON.parse(serialized)
  const svg = getSvgFromGraphicsObject(normalized, {
    svgWidth: SNAPSHOT_WIDTH,
    svgHeight: SNAPSHOT_HEIGHT,
    backgroundColor: "white",
    includeTextLabels: false,
  })
  if (process.env.UPDATE_PLAN_DRAWINGS === "1") {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, svg)
  }
  assert.equal(
    svg,
    readFileSync(path, "utf8"),
    `${module}/${name} SVG changed; inspect PNGs before updating snapshots`,
  )
}
