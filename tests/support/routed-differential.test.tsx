import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import type { SourceTrace } from "circuit-json"
import { RoutedPipelineSolver } from "../../src/pipeline"
import { prepareChannelSimulations } from "../fixtures/signal-render"
import { VendorDifferential } from "../fixtures/vendor-differential"
import { renderCoreSignals } from "./core-render"

/** Evidence for the routed length of one bus leg. */
interface RouteEvidence {
  sourceTraceId: SourceTrace["source_trace_id"]
  length_mm: number
}

test.skipIf(!process.env.IBIS_MODEL_DIR)(
  "differential receiver shares its pin with a termination stub",
  async () => {
    const circuit = await renderCoreSignals(<VendorDifferential />)
    const sources = {
      "models/sn65hvd72.ibs": await readFile(
        `${process.env.IBIS_MODEL_DIR}/sn65hvd72.ibs`,
        "utf8",
      ),
    }
    const [channelSimulation] = prepareChannelSimulations({ circuit, sources })
    assert.equal(
      channelSimulation.settings.lanes.length,
      4,
      "two bus routes and two termination stubs",
    )
    const port = {
      progress: (): void => undefined,
      runSolver: async (): Promise<never> => {
        throw new Error("compiler test must not run ngspice")
      },
    }
    const solver = new RoutedPipelineSolver({
      input: { circuitJson: circuit, ibisSources: sources },
      context: port,
    })
    solver.solveUntilStage("RouteTransientSolver")
    const result = solver.stageOutput("RouteNetworkSolver").value[0]
    assert.equal(
      result.probes.length,
      3,
      "differential receiver and both physical legs",
    )
    assert.match(
      result.deck,
      /R.*120/m,
      "physical termination remains in the circuit",
    )
    const routes = result.evidence.routes as RouteEvidence[]
    assert.equal(new Set(routes.map((route) => route.sourceTraceId)).size, 2)
    assert.ok(
      routes.every((route) => route.length_mm > 50),
      "route evidence describes both long bus legs, rather than the termination stubs",
    )
  },
)
