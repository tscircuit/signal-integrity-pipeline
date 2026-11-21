import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { simulation } from "@tscircuit/core"
import React from "react"
import { admitBuffers, compileBuffers } from "../../src/buffers"
import { rootScope } from "../../src/kernel"
import { generalDeclarations, modelRunDefinition } from "../../src/simulation"
import { Inverter, Reference } from "../fixtures/signal-parts"
import {
  admittedBindings,
  prepareBlocks,
  renderSignals,
} from "../fixtures/signal-render"
import Differential from "../fixtures/unit-differential"
import Single from "../fixtures/unit-single-ended"

const modelDir = process.env.IBIS_MODEL_DIR
/** Read actual vendor bytes only; no synthetic IBIS fallback. */
async function sources(): Promise<Record<string, Uint8Array>> {
  const files = ["sn74lvc1g04.ibs", "sn65hvd72.ibs"]
  const entries = await Promise.all(
    files.map(async (file) => [
      `models/${file}`,
      await readFile(`${modelDir}/${file}`),
    ]),
  )
  return Object.fromEntries(entries)
}

/** More than three physical conductors, expressed as real TSX. */
function Four(): React.JSX.Element {
  return (
    <board
      width={16}
      height={12}
      thickness={1.6}
      layers={4}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      {[0, 1, 2, 3].map((i) => (
        <React.Fragment key={i}>
          <Inverter
            name={`TX${i}`}
            x={-5}
            y={i * 0.4}
            powerY={3.2 - i * 0.4}
            driver
          />
          <Inverter
            name={`RX${i}`}
            x={5}
            y={i * 0.4}
            powerY={3.2 - i * 0.4}
            driver={false}
          />
          <trace
            from={`.TX${i} > .Y`}
            to={`.RX${i} > .A`}
            width={0.2}
            pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]}
          />
        </React.Fragment>
      ))}
      {/* Keep the ideal-supply contacts and copper beyond the 1 mm coupling horizon. */}
      <Reference powerStartMm={2.4} />
      <simulation.pcbtransientchannelsimulation
        name="FOUR"
        bitRate={20e6}
        duration={48 / 20e6}
      >
        {[0, 1, 2, 3].map((i) => (
          <simulation.pcbdriverreceiverchannel
            key={i}
            name={`D${i}`}
            driverRef={`.TX${i} > .Y`}
            receiverRef={`.RX${i} > .A`}
          />
        ))}
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

test("Real core renders source records and core-owned stackup without loading vendor assets", async () => {
  for (const Board of [Single, Differential, Four]) {
    const records = await renderSignals({ tree: <Board /> })
    assert.equal(records.filter((r) => r.type === "pcb_stackup").length, 1)
    assert.ok(
      records.some((r) => r.type === "simulation_pcb_driver_receiver_channel"),
    )
    assert.ok(
      !records.some((r) =>
        ["simulation_experiment", "simulation_voltage_probe"].includes(r.type),
      ),
    )
  }
})

test.skipIf(!modelDir)(
  "four-conductor derivation is invariant under signal record order",
  async () => {
    const circuit = await renderSignals({ tree: <Four /> })
    const ibis = await sources()
    const a = prepareBlocks({ circuit, sources: ibis })[0]
    const channels = circuit.filter(
      (r) => r.type === "simulation_pcb_driver_receiver_channel",
    )
    const otherRecords = circuit.filter(
      (r) => r.type !== "simulation_pcb_driver_receiver_channel",
    )
    const b = prepareBlocks({
      circuit: [...otherRecords, ...channels.reverse()],
      sources: ibis,
    })[0]
    assert.equal(a.settings.lanes.length, 4)
    assert.deepEqual(a.settings, b.settings)
  },
)

const differentialDescription =
  "RS485 differential identity and the placed termination are derived from real vendor data and TSX"
test.skipIf(!modelDir)(differentialDescription, async () => {
  const circuit = await renderSignals({ tree: <Differential /> })
  const ibis = await sources()
  const prepared = prepareBlocks({ circuit, sources: ibis })[0]
  const receiver = prepared.signals[0].receivers[0]
  assert.ok("p_source_port_id" in receiver)
  if (!("p_source_port_id" in receiver)) return
  const resistor = circuit
    .filter((r) => r.type === "source_component")
    .find((r) => r.name === "RTERM")!
  assert.ok(
    prepared.settings.passiveComponents?.some(
      (p) => p.sourceComponentId === resistor.source_component_id,
    ),
  )
  const reversed = await renderSignals({ tree: <Differential reversed /> })
  assert.throws(
    () => prepareBlocks({ circuit: reversed, sources: ibis }),
    /Signal "BUS": differential pin order disagrees with IBIS/,
  )
})

const signalDescription =
  "signal packages and vendor reference evidence remain present; disabled drivers reject output-only buffers"
test.skipIf(!modelDir)(signalDescription, async () => {
  const circuit = await renderSignals({ tree: <Single /> })
  const signal = circuit.find(
    (r) => r.type === "simulation_pcb_driver_receiver_channel",
  )!
  if (signal.type !== "simulation_pcb_driver_receiver_channel")
    throw new Error("missing signal")
  signal.driver_disabled = true
  const ibis = await sources()
  assert.throws(
    () => prepareBlocks({ circuit, sources: ibis }),
    /has no disabled state/,
  )
  signal.driver_disabled = false
  signal.pattern = "0"
  delete signal.seed
  const bindings = admittedBindings({ circuitJson: circuit, ibisSources: ibis })
  const declarations = generalDeclarations({
    circuit: bindings.circuitJson,
    mappings: bindings.mappings,
    modeling: bindings.modeling,
    controls: bindings.controls,
  })
  const admitted = admitBuffers({
    models: declarations.models,
    ibisSources: ibis,
    scope: rootScope("buffers"),
  })
  const [compiled] = compileBuffers({
    admitted: admitted.value,
    plans: declarations.plans,
    define: modelRunDefinition,
  })
  for (const model of compiled) {
    assert.equal(model.metadata.packagePolicy, "vendor")
    assert.match(model.source, /RPKG/)
    assert.match(model.source, /LPKG/)
    assert.match(model.source, /CPKG/)
    assert.equal(
      model.metadata.packageData.mappedPins.filter(
        (p) => p.role === "reference",
      ).length,
      2,
    )
  }
  assert.ok(
    compiled[0].metadata.pins.some(
      (p) => p.runState.mode === "output" && p.runState.enabled,
    ),
  )
})
