import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { Circuit } from "@tscircuit/core"
import type { GraphicsObject } from "graphics-debug"
import React from "react"
import Board from "../examples/level4-ddr3-write/level4-ddr3-write"
import { withDdr3Signals } from "../examples/routed/ddr3-signals"
import { createNativeSolver } from "../src/adapters"
import type { CircuitJson } from "../src/board"
import { boardPictureSvg } from "../src/board/board-picture"
import { sha256 } from "../src/kernel"
import { RoutedPipelineSolver } from "../src/pipeline"

/** Normalize Windows carriage return and line feed to the line feed used in saved logs. */
const WINDOWS_LINE_ENDING = "\r\n"
const LINE_FEED = "\n"
/** Keep the fallback diagnostic short enough to scan in the failure summary. */
const MAX_FAILURE_REASON_LENGTH = 240
/** Milliseconds allowed for the one native DDR3 simulation. */
const NATIVE_TIMEOUT_MS = 45 * 60 * 1000
/** Milliseconds between live progress reports. */
const PROGRESS_INTERVAL_MS = 15000
/** Keep the completed and failed stage drawings at a common export size. */
const RENDER_WIDTH = 1800
const RENDER_HEIGHT = 1400
/** Include adjacent copper when compiling the DDR3 routes. */
const ROUTE_SCOPE_DISTANCE_MM = 1

/** Use the first ngspice failure line or a short summary of the error. */
function ddrFailureReason(error: unknown): string {
  const lines = String(error)
    .replaceAll(WINDOWS_LINE_ENDING, LINE_FEED)
    .split(LINE_FEED)
  const diagnostic = lines.find((line) => {
    const lower = line.toLowerCase()
    return (
      lower.includes("timestep too small") ||
      lower.includes("fatal") ||
      lower.includes("aborted")
    )
  })
  return diagnostic ?? lines[0].slice(0, MAX_FAILURE_REASON_LENGTH)
}

// Every artifact can contain local board/model data: write only to an ignored or external directory.
const output = resolve(process.env.SI_STAGE_VISUALS_DIR ?? ".cache/ddr-level4")
const directory = process.env.IBIS_MODEL_DIR ?? "models"
const sourceEntries = await Promise.all(
  ["sprm552c.ibs", "W631GG6MB-12.ibs"].map(async (file) => [
    `models/${file}`,
    await readFile(join(directory, file), "utf8"),
  ]),
)
const ibisSources = Object.fromEntries(sourceEntries)
await mkdir(output, { recursive: true })
/** Save the stage's actual drawing over the real board, including an explicit failed state when no capture exists. */
async function render({
  name,
  drawing,
}: {
  name: string
  drawing: GraphicsObject
}): Promise<void> {
  const svg = boardPictureSvg({
    circuit: circuitJson,
    drawing,
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
  })
  await writeFile(join(output, `${name}.svg`), svg)
  const png = new Resvg(svg, { font: { defaultFontFamily: "Arial" } })
    .render()
    .asPng()
  await writeFile(join(output, `${name}.png`), png)
}
/** Render the lower-byte example or attach address/command declarations to the supplied board. */
async function loadBoard(addressCommand: boolean): Promise<CircuitJson> {
  if (addressCommand) {
    const boardFile =
      process.env.SI_DDR3_BOARD ?? join(directory, "ddr3-board.json")
    const physical = JSON.parse(
      await readFile(boardFile, "utf8"),
    ) as CircuitJson
    return withDdr3Signals({
      physicalRecords: physical,
      options: { block: "DDR3_ADDR_CMD" },
    })
  }
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson() as CircuitJson
  const errors = records.filter((record) => record.type.endsWith("_error"))
  if (errors.length) throw new Error(JSON.stringify(errors))
  return records
}

const circuitJson = await loadBoard(process.argv.includes("--addr-cmd"))
const native = createNativeSolver({ timeoutMs: NATIVE_TIMEOUT_MS })
let invocations = 0
let nativeMilliseconds = 0
const started = performance.now()
const timings: Record<string, number> = {}
const stats: Record<string, unknown> = {}
let stageStart = started
const root = new RoutedPipelineSolver({
  input: { circuitJson, ibisSources, scopeDistanceMm: ROUTE_SCOPE_DISTANCE_MM },
  context: {
    progress: console.log,
    runSolver: async (request) => {
      invocations++
      if (invocations !== 1 || request.solver !== "ngspice") {
        throw new Error("DDR evidence allows exactly one ngspice invocation")
      }
      await writeFile(
        join(output, "simulation.cir"),
        request.files["simulation.cir"],
      )
      const start = performance.now()
      try {
        const result = await native(request)
        await writeFile(join(output, "ngspice.stdout.log"), result.stdout)
        await writeFile(join(output, "ngspice.stderr.log"), result.stderr)
        return result
      } finally {
        nativeMilliseconds = performance.now() - start
      }
    },
  },
})
let last = started
try {
  while (!root.solved) {
    const name = root.getCurrentStageName()
    await root.stepAsync()
    const solver = root.getSolver(name)
    if (solver?.solved) {
      timings[name] = performance.now() - stageStart
      stats[name] = solver.stats
      stageStart = performance.now()
      console.log("Completed", name, timings[name], solver.stats)
      if (name === "RouteNetworkSolver") {
        const compiled = root.stageOutput("RouteNetworkSolver").value[0]
        await writeFile(
          join(output, "evidence.json"),
          JSON.stringify(compiled.evidence),
        )
        const compile = {
          cells: compiled.evidence.cells,
          deckBytes: Buffer.byteLength(compiled.deck),
          deckSha256: sha256(compiled.deck),
          qualification: "compiled-only",
        }
        await writeFile(
          join(output, "compile.json"),
          JSON.stringify(compile, null, 2),
        )
      }
    }
    if (performance.now() - last > PROGRESS_INTERVAL_MS) {
      console.log("Progress", name, solver?.stats, {
        rssBytes: process.memoryUsage().rss,
      })
      last = performance.now()
    }
  }
  const block = root.getOutput().blocks[0]
  await writeFile(join(output, "capture.json"), JSON.stringify(block.capture))
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(block.compiled.evidence),
  )
  const stage = root.getSolver("RouteTransientSolver")!
  await render({ name: "stage-6", drawing: stage.visualize() })
  const probes = block.capture.probes.map(({ name, voltageLevels }) => ({
    name,
    minimumV: voltageLevels.reduce(
      (minimum, value) => Math.min(minimum, value),
      Infinity,
    ),
    maximumV: voltageLevels.reduce(
      (maximum, value) => Math.max(maximum, value),
      -Infinity,
    ),
    finalV: voltageLevels.at(-1),
    finite: voltageLevels.every(Number.isFinite),
  }))
  await writeFile(
    join(output, "waveform-sanity.json"),
    JSON.stringify(probes, null, 2),
  )
  console.log("Completed candidate-unqualified", {
    cells: block.compiled.evidence.cells,
    deckBytes: Buffer.byteLength(block.compiled.deck),
    deckSha256: sha256(block.compiled.deck),
    probes,
  })
} catch (error) {
  const stage = root.getSolver("RouteTransientSolver")
  const reason = ddrFailureReason(error)
  if (stage)
    await render({ name: "stage-6-failed", drawing: stage.visualize() })
  await writeFile(join(output, "failure.log"), String(error))
  const failure = {
    stage: root.getCurrentStageName(),
    error: reason,
    capture: "No completed waveform",
  }
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(failure, null, 2),
  )
  throw error
} finally {
  const timing = {
    complete: root.solved,
    stage: root.getCurrentStageName(),
    wallMilliseconds: performance.now() - started,
    nativeMilliseconds,
    invocations,
    timings,
    stats,
    nodePeakRssKiB: process.resourceUsage().maxRSS,
  }
  await writeFile(join(output, "timing.json"), JSON.stringify(timing, null, 2))
}
