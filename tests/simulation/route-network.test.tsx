import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import { createNativeSolver } from "../../src/adapters"
import {
  RoutedPipelineSolver,
  type RoutedStageSolver,
} from "../../src/pipeline"
import {
  type RoutedDeck,
  type RouteNetworkInput,
  RouteNetworkSolver,
} from "../../src/simulation"
import { routedRequest } from "../../src/simulation/route-transient"
import { quietDriverIbis } from "../fixtures/routed-visual-fixture"
import { renderTwoTracePlanInput } from "../fixtures/two-trace-plan-input"
import Single from "../fixtures/unit-single-ended"
import { vendorAvailable } from "../fixtures/vendor-models"
import { renderCoreSignals } from "../support/core-render"

/** The network stage produces one routed deck per planned channel simulation. */
type NetworkStage = RoutedStageSolver<RouteNetworkInput, RoutedDeck>

let testNetwork: NetworkStage | undefined

/** Assemble the network from the rendered fixture and the local vendor model. */
async function routedNetwork(): Promise<NetworkStage> {
  if (testNetwork) return testNetwork
  const input = await renderTwoTracePlanInput()
  const solverContext = {
    progress: (): void => undefined,
    runSolver: async (): Promise<never> => {
      throw new Error("network test must not run ngspice")
    },
  }
  const root = new RoutedPipelineSolver({ input, context: solverContext })
  root.solveUntilStage("RouteTransientSolver")
  const network = root.getSolver<NetworkStage>(RouteNetworkSolver.name)!
  testNetwork = network
  return network
}

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "steps through ladder runs",
  async () => {
    const network = await routedNetwork()
    assert.ok(network.iterations >= 3)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "records ladder statistics",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value[0]
    assert.ok(output.evidence.cells)
    assert.ok(output.evidence.maximum_cell_delay_s)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "anchors floating copper",
  async () => {
    const network = await routedNetwork()
    assert.ok(network.getOutput().value[0].deck.includes("RBIAS"))
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "sets the KLU pivot tolerance",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value[0]
    // klu_refactor reuses the first transient pivots; the zero-diagonal skin multiport rows need KLU tol 0.1.
    assert.match(output.deck, /^\.options klu .* pivrel=0\.1$/m)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "keeps all planned probes",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value[0]
    assert.equal(
      output.probes.length,
      3,
      "two receivers and the existing rail monitor",
    )
    assert.ok(
      network
        .visualize()
        .lines!.some((line) => line.strokeColor === routeTones.cell),
      "ladder cells are ticks across the copper",
    )
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "records the scope of candidate evidence",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value[0]
    assert.ok(
      (output.evidence.warnings as string[]).some((warning) =>
        warning.includes("candidate channel experiment"),
      ),
    )
  },
)

import { routeTones } from "../../src/board"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX route-network visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root
      .getSolver<RouteNetworkSolver>("RouteNetworkSolver")!
      .visualize(),
    module: "simulation",
    name: "route-network",
  })
})

test("rejected network drawing retains physical context and shows its red reason", async () => {
  const { root } = await routedVisualFixture()
  const stage =
    root.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>(
      "RouteNetworkSolver",
    )!
  const [[params]] = stage.getConstructorParams()
  const rejected = new RouteNetworkSolver(params)
  // Drawing-only failure state; the real DDR render separately exercises the 1,024-cell admission gate.
  rejected.failed = true
  rejected.error =
    "Route ladder requires 1835 cells; exceeds modest-memory limit of 1024"
  const drawing = rejected.visualize()
  assert.ok(
    drawing.texts!.some(
      (text) => text.color === routeTones.failure && text.text.includes("1835"),
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "simulation",
    name: "route-network-rejected",
  })
})

/** One unit interval is 2 ns at this rate. */
const QUIET_BIT_RATE_BPS = 500e6
/** The offset lies beyond both capture windows. */
const QUIET_OFFSET_SECONDS = 200e-9
/** The default quiet capture spans one unit interval at 500 Mbps. */
const QUIET_CAPTURE_END_SECONDS = 1 / QUIET_BIT_RATE_BPS
/** Preserve the longer regression capture with an explicit duration. */
const EXPLICIT_CAPTURE_SECONDS = 64e-9
/** Allow for rounding when ngspice writes timestamps as decimal text. */
const TIMESTAMP_TOLERANCE_SECONDS = 1e-12
/** A conservative high level for the synthetic 3.3 V output. */
const HIGH_THRESHOLD_VOLTS = 2.5

/** Assert the grounded driver holds high for every sample in the requested capture. */
async function assertConstantHighCapture({
  durationSeconds,
  expectedEndSeconds,
}: {
  durationSeconds?: number
  expectedEndSeconds: number
}): Promise<void> {
  const circuitJson = await renderCoreSignals(
    <Single
      bitRate={QUIET_BIT_RATE_BPS}
      pattern="1"
      timing={{ offsetSeconds: QUIET_OFFSET_SECONDS, durationSeconds }}
    />,
  )
  const ibisSources = { "models/sn74lvc1g04.ibs": quietDriverIbis }
  const solve = createNativeSolver({
    tools: { ngspice: process.env.NGSPICE_BIN },
  })
  const root = new RoutedPipelineSolver({
    input: { circuitJson, ibisSources },
    context: { progress: (): void => undefined, runSolver: solve },
  })
  root.solveUntilStage("RouteTransientSolver")
  const compiled = root.stageOutput("RouteNetworkSolver").value[0]
  const driver = circuitJson.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )?.driver
  assert.ok(driver && "source_port_id" in driver)
  const driverProbe = compiled.probes.find(
    (probe) => probe.signalSourceId === driver.source_port_id,
  )
  assert.ok(
    driverProbe?.referenceNode === "0",
    "the driver probe is referenced to ground",
  )
  const request = routedRequest(compiled)
  const [rawFile] = request.outputFiles
  const output = await solve({
    ...request,
    args: ["-D", "filetype=ascii", ...request.args],
  })
  const waveform = output.files[rawFile]
  assert.ok(waveform, `ngspice did not write the waveform\n${output.stderr}`)
  const [header, values] = waveform.trimEnd().split("\nValues:\n")
  const variables = header.split("\nVariables:\n")[1]
  assert.ok(variables && values, "expected ASCII ngspice variables and values")
  const names = variables.split("\n").map((line) => line.trim().split("\t")[1])
  const voltageColumn = names.indexOf(
    `v(${driverProbe.signalNode.toLowerCase()})`,
  )
  assert.equal(names[0], "time")
  assert.ok(voltageColumn > 0, "the waveform contains the driver voltage")

  // Each sample records its index followed by one value per declared variable.
  const fieldsPerSample = names.length + 1
  const fields = values
    .split("\n")
    .flatMap((line) => line.split("\t"))
    .filter(Boolean)
    .map(Number)
  assert.equal(fields.length % fieldsPerSample, 0)
  const times = []
  const voltages = []
  for (let start = 0; start < fields.length; start += fieldsPerSample) {
    times.push(fields[start + 1])
    voltages.push(fields[start + 1 + voltageColumn])
  }
  const endSeconds = times.at(-1)
  assert.equal(times[0], 0)
  assert.ok(endSeconds !== undefined)
  assert.ok(
    Math.abs(endSeconds - expectedEndSeconds) <= TIMESTAMP_TOLERANCE_SECONDS,
  )
  const minVolts = Math.min(...voltages)
  assert.ok(
    minVolts >= HIGH_THRESHOLD_VOLTS,
    `expected every sample to be high, minimum was ${minVolts} V`,
  )
  console.log(
    `${voltages.length} samples, minimum ${minVolts.toFixed(9)} V, from t=0 through ${endSeconds} s`,
  )
}

test.skipIf(!process.env.SI_TEST_SWITCHING_NGSPICE)(
  "a constant-high driver stays high throughout the default capture",
  async () => {
    await assertConstantHighCapture({
      expectedEndSeconds: QUIET_CAPTURE_END_SECONDS,
    })
  },
)

test.skipIf(!process.env.SI_TEST_SWITCHING_NGSPICE)(
  "a constant-high driver stays high throughout an explicit capture",
  async () => {
    await assertConstantHighCapture({
      durationSeconds: EXPLICIT_CAPTURE_SECONDS,
      expectedEndSeconds: EXPLICIT_CAPTURE_SECONDS,
    })
  },
)
