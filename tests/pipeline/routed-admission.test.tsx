import { test } from "bun:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { simulation } from "@tscircuit/core"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import { sha256 } from "../../src/kernel"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import { prepareBlockById, signalBlocks } from "../../src/pipeline/signals"
import { circuitNodes } from "../../src/simulation"
import { AdmissionChannel } from "../fixtures/admission-channel"
import { routedVisualIbis } from "../fixtures/routed-visual-fixture"
import { renderSignals } from "../fixtures/signal-render"
import { vendorAvailable } from "../fixtures/vendor-models"
import { renderCoreSignals } from "../support/core-render"
import { routedProblem } from "../support/routed-fixture"

const skipVendorModel = !vendorAvailable("sn74lvc1g04.ibs")

const inverterModelPath = "models/sn74lvc1g04.ibs"

test("synthetic admission emits the board mappings and hashes the supplied bytes", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = Buffer.from(routedVisualIbis)
  const input = {
    circuitJson,
    ibisSources: { [inverterModelPath]: bytes },
    scopeDistanceMm: 1,
  }
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, true)
  const {
    value: [plan],
    artifacts,
  } = solver.getOutput()
  const [block] = signalBlocks(circuitJson)
  const id = block.simulation_pcb_transient_channel_simulation_id
  const signals = circuitJson.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  const traces = circuitJson.filter((record) => record.type === "source_trace")
  const expectedMappings = signals.map((signal) => {
    assert.ok(
      "source_port_id" in signal.driver &&
        "source_port_id" in signal.receivers[0],
    )
    const from = signal.driver.source_port_id
    const to = signal.receivers[0].source_port_id
    const trace = traces.find((record) => {
      const ports = record.connected_source_port_ids
      return ports.length === 2 && ports.includes(from) && ports.includes(to)
    })
    assert.ok(trace, signal.name)
    return { port: signal.name, from, to, sourceTraceId: trace.source_trace_id }
  })
  assert.deepEqual(plan.bindings.mappings, expectedMappings)
  assert.equal(plan.sections.scope.selectedPcbTraceIds.length, 2)
  assert.deepEqual(
    artifacts.map((artifact) => artifact.path),
    ["admission.json"],
  )
  assert.deepEqual(JSON.parse(artifacts[0].body), {
    blocks: [{ id, name: "TWO", warnings: [] }],
    models: {
      [inverterModelPath]: createHash("sha256").update(bytes).digest("hex"),
    },
  })
  assert.throws(
    () => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(),
    /scope distance/,
  )
})

test.skipIf(skipVendorModel)(
  "vendor admission retains shared block lowering and warnings",
  async () => {
    const input = await routedProblem()
    const [id] = signalBlocks(input.circuitJson).map(
      (block) => block.simulation_pcb_transient_channel_simulation_id,
    )
    const block = prepareBlockById({
      circuit: input.circuitJson,
      sources: input.ibisSources,
      blockId: id,
      distanceMm: input.scopeDistanceMm,
    })
    const solver = new RoutedAdmissionSolver(input)
    solver.step()
    assert.equal(solver.solved, true)
    const [plan] = solver.getOutput().value
    assert.deepEqual(plan.sections.circuitJson, block.circuit)
    assert.deepEqual(plan.sections.scope, block.settings.copperScope)
    assert.deepEqual(plan.warnings, [])
    assert.equal(
      solver.getOutput().value[0].sections.scope.selectedPcbTraceIds.length,
      2,
    )
  },
)

test("empty boards admit no fake blocks", () => {
  const solver = new RoutedAdmissionSolver({ circuitJson: [], ibisSources: {} })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})

test("byte inputs retain the exact admitted model bytes", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = Buffer.from(
    "\uFEFF| Synthetic Ω fixture\r\n" + routedVisualIbis,
  )
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: bytes },
  })
  solver.solve()
  const {
    value: [plan],
    artifacts: [manifest],
  } = solver.getOutput()
  assert.equal(
    sha256(plan.bindings.ibisSources[inverterModelPath]),
    sha256(bytes),
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    sha256(bytes),
  )
})

test("all blocks and the manifest use the same captured inputs", async () => {
  const board = TwoTraceBoard()
  const circuitJson = await renderCoreSignals(
    React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <simulation.pcbtransientchannelsimulation name="ALT" bitRate="50Mbps">
          <simulation.pcbdriverreceiverchannel
            name="ALT_DATA"
            driverRef=".TX0 > .Y"
            receiverRef=".RX0 > .A"
          />
        </simulation.pcbtransientchannelsimulation>
      </>,
    ),
  )
  const ibisSources = { [inverterModelPath]: routedVisualIbis }
  const input = { circuitJson, ibisSources, scopeDistanceMm: 1 }
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, false)
  ibisSources[inverterModelPath] += "| Modified after the first step\n"
  signalBlocks(circuitJson)[1].name = "Changed"
  input.scopeDistanceMm = 2
  solver.step()
  const {
    value: plans,
    artifacts: [manifest],
  } = solver.getOutput()
  assert.deepEqual(
    plans.map((plan) => plan.bindings.ibisSources[inverterModelPath]),
    [routedVisualIbis, routedVisualIbis],
  )
  assert.deepEqual(
    plans.map((plan) => plan.name),
    ["TWO", "ALT"],
  )
  assert.deepEqual(
    plans.map((plan) => plan.sections.scope.lateralDistanceMm),
    [1, 1],
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    sha256(routedVisualIbis),
  )
})

test("an empty serialized block ID fails immediately", async () => {
  // Simulate imported records where the block has no channel references to its ID.
  const rendered = await renderCoreSignals(<TwoTraceBoard />)
  const circuitJson = rendered.filter(
    (record) => record.type !== "simulation_pcb_driver_receiver_channel",
  )
  const [block] = signalBlocks(circuitJson)
  block.simulation_pcb_transient_channel_simulation_id = ""
  const solver = new RoutedAdmissionSolver({ circuitJson, ibisSources: {} })
  assert.throws(() => solver.step(), { code: "simulation_id" })
})

test("sectioning and binding share one frozen board", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const { value } = solver.getOutput()
  const [plan] = value
  assert.ok(plan.sections.circuitJson === plan.bindings.circuitJson)
  assert.ok(Object.isFrozen(plan.sections.circuitJson))
  assert.ok(Object.isFrozen(plan.sections.circuitJson[0]))
  assert.ok(Object.isFrozen(value))
})

test("allowed unrouted channels retain ideal source connectivity", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  assert.deepEqual(bindings.mappings, [])
  assert.deepEqual(sections.requiredSourcePortIds, [])
  const signal = circuitJson.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  assert.ok(
    signal &&
      "source_port_id" in signal.driver &&
      "source_port_id" in signal.receivers[0],
  )
  const { node } = circuitNodes({
    circuit: bindings.circuitJson,
    modeling: bindings.modeling,
    mappings: bindings.mappings,
  })
  assert.equal(
    node(signal.driver.source_port_id),
    node(signal.receivers[0].source_port_id),
  )
})

test("series resistor keeps both routed segments electrically distinct", async () => {
  const circuitJson = await renderCoreSignals(
    <AdmissionChannel route="series" />,
  )
  signalBlocks(circuitJson)[0].allow_unrouted_traces = false
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  assert.equal(sections.requiredSourcePortIds.length, 4)
  assert.equal(bindings.mappings.length, 1)
  const [mapping] = bindings.mappings
  const traces = circuitJson.filter((record) => record.type === "source_trace")
  const driverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(mapping.from),
  )
  const receiverTrace = traces.find((trace) =>
    trace.connected_source_port_ids.includes(mapping.to),
  )
  assert.ok(driverTrace && receiverTrace)
  const { node } = circuitNodes({
    circuit: bindings.circuitJson,
    modeling: bindings.modeling,
    mappings: bindings.mappings,
  })
  for (const trace of [driverTrace, receiverTrace]) {
    const [from, to] = trace.connected_source_port_ids
    assert.notEqual(node(from), node(to), trace.source_trace_id)
  }
  assert.deepEqual(mapping.sourceTraceIds, [
    driverTrace.source_trace_id,
    receiverTrace.source_trace_id,
  ])
})

test("a routed receiver segment survives an ideal driver segment", async () => {
  const circuitJson = await renderSignals({
    tree: <AdmissionChannel route="receiver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections }] = solver.getOutput().value
  const [traceId] = sections.scope.selectedPcbTraceIds
  const trace = circuitJson.find(
    (record) => record.type === "pcb_trace" && record.pcb_trace_id === traceId,
  )
  assert.ok(trace?.type === "pcb_trace" && trace.source_trace_id)
  assert.equal(sections.scope.selectedPcbTraceIds.length, 1)
  assert.deepEqual(
    bindings.mappings.map((mapping) => mapping.sourceTraceId),
    [trace.source_trace_id],
  )
})

test("admission rejects a transient step that underflows to zero", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const driverModel = routedVisualIbis
    .split("[Rising Waveform]")[0]
    .replaceAll("1.98/1n", "1.98/5e-324")
  const receiverModel = routedVisualIbis.slice(
    routedVisualIbis.indexOf("[Model] LVC1G04_IN_33"),
  )
  const ibisSources = { [inverterModelPath]: driverModel + receiverModel }
  assert.throws(
    () => new RoutedAdmissionSolver({ circuitJson, ibisSources }).solve(),
    /admitted experiment.*time_per_step/,
  )
})
