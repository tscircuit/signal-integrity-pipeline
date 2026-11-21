import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { addrCmdPins } from "../../examples/routed/ddr3-signals"
import { fullBoardDdr3 } from "../fixtures/full-board-ddr3"
import { prepareBlocks } from "../fixtures/signal-render"

const path = process.env.SI_DDR3_BOARD
const models = process.env.IBIS_MODEL_DIR
/** Pin the exact model revision used by the expected capacitance sign-correction diagnostic. */
const CPU_MODEL_SHA256 =
  "23011a68eb8ff35562615b5b108edcb9f017c5e61f4f68e32f35c5fb88f163be"

const modelSelection = "DDR3 declarations preserve copper and select models"
test.skipIf(!path || !models)(modelSelection, async () => {
  const circuit = await fullBoardDdr3({ path: path! })
  assert.equal(
    circuit.filter(
      (record) => record.type === "simulation_pcb_driver_receiver_channel",
    ).length,
    10,
  )
  const boardTraceCount = circuit.filter(
    (record) => record.type === "pcb_trace",
  ).length
  assert.equal(boardTraceCount, 651)
  assert.equal(
    circuit.filter((record) => record.type === "pcb_via").length,
    1210,
  )
  const sourceEntries = await Promise.all(
    ["sprm552c.ibs", "W631GG6MB-12.ibs"].map(async (file) => [
      `models/${file}`,
      await readFile(`${models}/${file}`),
    ]),
  )
  const sources = Object.fromEntries(sourceEntries)
  // Branched neighbours such as RN5_INPUT_SYS4_CPU_PULL stay in the copper scope; only selected copper becomes lanes.
  const [write] = prepareBlocks({ circuit, sources, distanceMm: 1 })
  const cpuModelRevision = `models/sprm552c.ibs SHA-256 ${CPU_MODEL_SHA256}`
  assert.ok(write.warnings)
  assert.ok(
    write.warnings.some(
      (warning) =>
        warning.includes(cpuModelRevision) && warning.includes("negated 30450"),
    ),
  )
  assert.equal(write.settings.copperScope.selectedPcbTraceIds.length, 11)
  assert.ok(
    boardTraceCount - write.settings.copperScope.pcbTraceIds.length > 400,
  )
  assert.ok(
    write.settings.copperScope.pcbTraceIds.length > 11,
    "physically relevant neighbours must stay",
  )
  const addr = await fullBoardDdr3({
    path: path!,
    options: { block: "DDR3_ADDR_CMD" },
  })
  const original = JSON.parse(await readFile(path!, "utf8")) as typeof addr
  assert.deepEqual(addr.slice(0, original.length), original)
  assert.equal(
    addr.filter(
      (record) => record.type === "simulation_pcb_driver_receiver_channel",
    ).length,
    24,
  )
  const [block] = prepareBlocks({ circuit: addr, sources })
  assert.equal(block.block.name, "DDR3_ADDR_CMD")
  assert.ok(Math.abs(block.durationSeconds - 8e-9) <= Number.EPSILON * 8e-9)
  const [local] = prepareBlocks({ circuit: addr, sources, distanceMm: 1 })
  assert.equal(local.settings.copperScope!.lateralDistanceMm, 1)
  assert.deepEqual(
    local.settings.copperScope!.selectedPcbTraceIds,
    block.settings.copperScope!.selectedPcbTraceIds,
  )
  assert.equal(local.settings.lanes.length, 24)
  assert.ok(
    local.settings.copperScope!.pcbTraceIds.length <
      block.settings.copperScope!.pcbTraceIds.length,
  )
  for (const distanceMm of [0, -1, NaN, Infinity, 33]) {
    assert.throws(
      () => prepareBlocks({ circuit: addr, sources, distanceMm }),
      /scope distance/,
    )
  }
  assert.deepEqual(
    new Set(block.signals.map((signal) => signal.name)),
    new Set(addrCmdPins.map(([name]) => name)),
  )
  for (const signal of block.signals) {
    assert.ok("source_port_id" in signal.driver)
    let expectedDriver = "Model_352"
    if (signal.name === "CK" || signal.name === "CKn")
      expectedDriver = "Model_343"
    assert.equal(
      block.pins.get(signal.driver.source_port_id)!.buffer.name,
      expectedDriver,
    )
    assert.ok("source_port_id" in signal.receivers[0])
    assert.equal(
      block.pins.get(signal.receivers[0].source_port_id)!.buffer.name,
      "CMD",
    )
  }
  const stack = addr.find((record) => record.type === "pcb_stackup")!
  assert.equal(
    stack.layers.filter((layer) => layer.layer_type === "copper").length,
    8,
  )
  const dielectrics = stack.layers.filter(
    (layer) => layer.layer_type === "dielectric",
  )
  assert.deepEqual(
    dielectrics.map((layer) => layer.thickness),
    [0.0994, 0.2, 0.1088, 0.2, 0.1088, 0.2, 0.0994],
  )
  assert.equal(stack.plated_hole_copper_thickness, 0.018)
})

const isolatedA4 = "A4 isolation preserves DDR3 copper"
test.skipIf(!path || !models)(isolatedA4, async () => {
  const original = JSON.parse(await readFile(path!, "utf8"))
  for (const driverModel of ["Model_352", "Model_345", "Model_273"] as const) {
    const circuit = await fullBoardDdr3({
      path: path!,
      options: { block: "DDR3_ADDR_CMD", pattern: "isolated-a4", driverModel },
    })
    assert.deepEqual(circuit.slice(0, original.length), original)
    const signals = circuit.filter(
      (record) => record.type === "simulation_pcb_driver_receiver_channel",
    )
    assert.equal(signals.length, 24)
    assert.equal(
      signals.find((signal) => signal.name === "A4")!.pattern,
      "prbs7",
    )
    assert.ok(
      signals
        .filter((signal) => signal.name !== "A4")
        .every((signal) => signal.pattern === "0"),
    )
    for (const signal of signals) {
      assert.ok("source_port_id" in signal.driver)
      let expectedDriver: string = driverModel
      if (signal.name === "CK" || signal.name === "CKn")
        expectedDriver = "Model_343"
      assert.equal(signal.driver.ibis_model_name, expectedDriver)
    }
  }
  const selected = ["A4", "A5", "A7", "A9", "A11", "CASn"]
  const reduced = await fullBoardDdr3({
    path: path!,
    options: { block: "DDR3_ADDR_CMD", nets: selected, pattern: "victim-even" },
  })
  assert.deepEqual(reduced.slice(0, original.length), original)
  const reducedSignals = reduced.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  assert.deepEqual(
    reducedSignals.map((signal) => signal.name),
    selected,
  )
  assert.equal(
    reducedSignals.find((signal) => signal.name === "A4")!.pattern,
    "0",
  )
})
