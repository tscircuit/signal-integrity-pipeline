import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { Circuit } from "@tscircuit/core"
import type { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import React from "react"
import { withDdr3Signals } from "../examples/routed/ddr3-signals"
import { TwoTraceBoard } from "../examples/routed/two-trace-board"
import { createNativeSolver } from "../src/adapters"
import { type CircuitJson, routeTones } from "../src/board"
import { boardPictureSvg } from "../src/board/board-picture"
import { sha256 } from "../src/kernel"
import {
  RoutedPipelineSolver,
  type RoutedProblem,
  routedStages,
} from "../src/pipeline"

// All vendor assets, physical board JSON, decks and renders remain outside Git.
const output = resolve(
  process.env.SI_STAGE_VISUALS_DIR ?? ".cache/stage-visuals",
)
const models = resolve(process.env.IBIS_MODEL_DIR ?? "models")
await mkdir(output, { recursive: true })
const manifest: Record<string, unknown> = {}

/** One stage drawing and its output filename stem. */
interface StageRender {
  circuit: CircuitJson
  name: string
  drawing: GraphicsObject
}

const stageNames = [
  "admission",
  "sections",
  "fields",
  "bindings",
  "network",
  "transient",
]

/** How often to report progress during a long stage. */
const PROGRESS_INTERVAL_MS = 15_000
/** Rendering uses a common canvas for every stage of the same board. */
const RENDER_WIDTH = 1600
const RENDER_HEIGHT = 1100
/** Time limit for the optional two-trace native capture. */
const TWO_TRACE_TIMEOUT_MS = 10_000
/** Include nearby copper in the two-trace stage views. */
const TWO_TRACE_SCOPE_DISTANCE_MM = 1

/** Rasterize the stage drawing over the real board, exactly as the site composes it. */
async function render({ circuit, name, drawing }: StageRender): Promise<void> {
  const svg = boardPictureSvg({
    circuit,
    drawing,
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
  })
  await writeFile(
    join(output, `${name}.graphics.json`),
    JSON.stringify(drawing),
  )
  await writeFile(join(output, `${name}.svg`), svg)
  const png = new Resvg(svg, { font: { defaultFontFamily: "Arial" } })
    .render()
    .asPng()
  await writeFile(join(output, `${name}.png`), png)
  const lists = Object.values(drawing).filter(Array.isArray)
  const objects = lists.reduce((count, objects) => count + objects.length, 0)
  console.log(`${name}: ${objects} objects`)
  manifest[name] = {
    png: join(output, `${name}.png`),
    svg: join(output, `${name}.svg`),
    objects,
  }
  await writeFile(
    join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

/** Record each completed stage as it becomes available, without re-running the field extraction. */
async function stages({
  name,
  input,
}: {
  name: string
  input: RoutedProblem
}): Promise<void> {
  const execute =
    name === "two-trace" && process.argv.includes("--native-two-trace")
  const context = {
    runSolver: createNativeSolver({ timeoutMs: TWO_TRACE_TIMEOUT_MS }),
    progress: console.log,
  }
  const root = new RoutedPipelineSolver({ input, context })
  const circuit = input.circuitJson
  await render({
    circuit,
    name: `${name}-root-initial`,
    drawing: root.initialVisualize(),
  })
  const seen = new Set<string>()
  let progress = performance.now()
  while (!root.solved) {
    if (root.getCurrentStageName() === "RouteTransientSolver" && !execute) {
      await render({
        circuit,
        name: `${name}-5-transient-pending`,
        drawing: root.visualizeStage(6),
      })
      break
    }
    try {
      await root.stepAsync()
    } catch (error) {
      const stage = root.getCurrentStageName()
      const index = routedStages.findIndex(
        (entry) => entry.solverName === stage,
      )
      const solver = root.getSolver(stage)!
      if (stage === "RouteTransientSolver") {
        await render({
          circuit,
          name: `${name}-5-transient-failed`,
          drawing: solver.visualize(),
        })
        throw error
      }
      await render({
        circuit,
        name: `${name}-${index}-network-rejected`,
        drawing: solver.visualize(),
      })
      manifest[`${name}-blocked`] = {
        stage,
        reason: String(error),
        capture: "capture solver was not reached",
      }
      await writeFile(
        join(output, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
      console.log(`${name}: BLOCKED ${String(error)}`)
      return
    }
    for (const stage of root.pipelineDef) {
      const solver = root.getSolver<BaseSolver>(stage.solverName)
      if (
        stage.solverName === "RouteFieldsSolver" &&
        solver &&
        !solver.solved &&
        solver.stats.sections > 0 &&
        !seen.has("fields-coupled")
      ) {
        const drawing = solver.visualize()
        if (
          drawing.polygons?.some(
            (polygon) => polygon.fill === routeTones.coupling,
          )
        ) {
          seen.add("fields-coupled")
          await render({ circuit, name: `${name}-2-fields-coupled`, drawing })
        }
      }
      if (!solver?.solved || seen.has(stage.solverName)) continue
      seen.add(stage.solverName)
      if (
        stage.solverName === "RouteFieldsSolver" ||
        stage.solverName === "RouteBindingsSolver"
      )
        await writeFile(
          join(output, `${name}-${stage.solverName}.state.json`),
          JSON.stringify({
            input: solver.getConstructorParams(),
            output: solver.getOutput(),
          }),
        )
      const index = routedStages.findIndex(
        (entry) => entry.solverName === stage.solverName,
      )
      const filename = `${name}-${index}-${stageNames[index]}`
      await render({ circuit, name: filename, drawing: solver.visualize() })
    }
    if (performance.now() - progress > PROGRESS_INTERVAL_MS) {
      const stage = root.getCurrentStageName()
      const stats = root.getSolver(stage)?.stats
      console.log(`${name}: stepping ${stage} ${JSON.stringify(stats)}`)
      progress = performance.now()
    }
  }
  const compiled = root.stageOutput("RouteNetworkSolver").value[0]
  await writeFile(
    join(output, `${name}.evidence.json`),
    JSON.stringify(compiled.evidence),
  )
  await writeFile(join(output, `${name}.cir`), compiled.deck)
  manifest[`${name}-deck`] = {
    bytes: Buffer.byteLength(compiled.deck),
    sha256: sha256(compiled.deck),
  }
  // Compile-only renders stop before stage 5; only a completed live run gets a final atlas.
  if (root.solved)
    await render({
      circuit,
      name: `${name}-root-final`,
      drawing: root.visualize(),
    })
}

const twoSource = await readFile(join(models, "sn74lvc1g04.ibs"), "utf8")
const core = new Circuit({ platform: { partsEngineDisabled: true } })
core.add(<TwoTraceBoard />)
await core.renderUntilSettled()
await stages({
  name: "two-trace",
  input: {
    circuitJson: core.getCircuitJson() as CircuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": twoSource },
    scopeDistanceMm: TWO_TRACE_SCOPE_DISTANCE_MM,
  },
})

/** Export the full-board stage drawings when the local DDR3 board is available. */
async function renderDdr3(boardPath?: string): Promise<void> {
  if (!boardPath) {
    const needed = "set SI_DDR3_BOARD and local sprm552c.ibs / W631GG6MB-12.ibs"
    console.log(
      `DDR3 board JSON unavailable: ${needed} to render its 24-net addr/cmd scope`,
    )
    manifest.ddr3 = "unavailable: SI_DDR3_BOARD not supplied"
    return
  }
  const physical: CircuitJson = JSON.parse(await readFile(boardPath, "utf8"))
  const sourceEntries = await Promise.all(
    ["sprm552c.ibs", "W631GG6MB-12.ibs"].map(async (name) => [
      `models/${name}`,
      await readFile(join(models, name), "utf8"),
    ]),
  )
  const ibisSources = Object.fromEntries(sourceEntries)
  const circuitJson = await withDdr3Signals({
    physicalRecords: physical,
    options: { block: "DDR3_ADDR_CMD" },
  })
  await stages({
    name: "ddr3-addr-cmd",
    input: { circuitJson, ibisSources, scopeDistanceMm: 1 },
  })
}
await renderDdr3(process.env.SI_DDR3_BOARD)
await writeFile(
  join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
