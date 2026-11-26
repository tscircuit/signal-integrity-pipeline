/* eslint-disable local/max-file-lines -- Preparation tests share one TSX board and declaration setup. */

import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import { endpointPorts } from "../../src/board"
import { compareNames } from "../../src/pipeline/signal-names"
import {
  listChannelSimulations,
  type PreparedChannelSimulation,
  prepareChannelSimulationById,
} from "../../src/pipeline/signals"
import { electricalSources, generalDeclarations } from "../../src/simulation"
import {
  differentialIbis,
  routedVisualIbis,
  separateClampIbis,
} from "../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../fixtures/signal-parts"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../fixtures/signal-render"
import Differential from "../fixtures/unit-differential"

const inverterIbisPath = "models/sn74lvc1g04.ibs"

const inverterSources = { [inverterIbisPath]: routedVisualIbis }

interface BoardProps {
  missing?: boolean
  via?: boolean
  branch?: boolean
  unlisted?: boolean
  extraDriver?: boolean
  driverDisabled?: boolean
  clampNet?: string
  pattern?: string
  offset?: number
  duration?: number
  allowUnroutedTraces?: boolean
}

/** Render the regression board, including the deliberately incomplete route after RS when requested. */
function Board({
  missing = false,
  via = false,
  branch = false,
  unlisted = false,
  extraDriver = false,
  driverDisabled = false,
  clampNet,
  pattern,
  offset = 0,
  duration,
  allowUnroutedTraces = false,
}: BoardProps): React.JSX.Element {
  const driverRef = ".TX > .Y"
  const receiverRef = ".RX > .A"
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [driverRef]
  if (via) {
    pcbPath.push(
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      {
        x: 1,
        y: 0,
        via: true,
        fromLayer: "top",
        toLayer: "inner2",
      },
      { x: 9, y: 0 },
      {
        x: 9,
        y: 0,
        via: true,
        fromLayer: "inner2",
        toLayer: "top",
      },
    )
  }
  pcbPath.push(receiverRef)
  let neighbourDriverRef = ".TX1 > .Y"
  if (branch) neighbourDriverRef = driverRef
  const neighbourReceiverRef = ".RX1 > .A"
  const neighbourPath: NonNullable<TraceProps["pcbPath"]> = [neighbourDriverRef]
  if (branch) neighbourPath.push({ x: 5, y: 1 })
  neighbourPath.push(neighbourReceiverRef)
  let aggressorPattern: string | undefined
  if (branch || unlisted) aggressorPattern = "0"
  let receivers: string | string[] = receiverRef
  if (branch) receivers = [receiverRef, neighbourReceiverRef]
  return (
    <board
      width={18}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
      allowBlindAndBuriedVias
    >
      <Inverter name="TX" x={-5} y={0} driver clampNet={clampNet} />
      <Inverter name="RX" x={5} y={0} driver={false} clampNet={clampNet} />
      <Reference />
      {clampNet === "net.PC" && <net name="PC" />}
      {missing && (
        <>
          <resistor
            name="RS"
            resistance="33"
            pcbX={0}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={-0.5}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin2"]}
                  pcbX={0.5}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </footprint>
            }
          />
          <trace
            from=".TX > .Y"
            to=".RS > .pin1"
            width={0.2}
            pcbPath={[".TX > .Y", ".RS > .pin1"]}
          />
          <trace from=".RS > .pin2" to=".RX > .A" />
        </>
      )}
      {!missing && (
        <trace
          from={driverRef}
          to={receiverRef}
          width={0.2}
          pcbPath={pcbPath}
        />
      )}
      {(branch || unlisted) && (
        <>
          <Inverter name="TX1" x={-5} y={1} driver />
          <Inverter name="RX1" x={5} y={1} driver={false} />
          <trace
            from={neighbourDriverRef}
            to={neighbourReceiverRef}
            width={0.2}
            pcbPath={neighbourPath}
          />
        </>
      )}
      {extraDriver && (
        <>
          <Inverter name="TX1" x={-5} y={1} driver />
          <trace
            from=".TX > .Y"
            to=".TX1 > .Y"
            width={0.2}
            pcbPath={[".TX > .Y", ".TX1 > .Y"]}
          />
        </>
      )}
      <simulation.pcbtransientchannelsimulation
        bitRate="20Mbps"
        duration={duration}
        allowUnroutedTraces={allowUnroutedTraces}
        aggressorPattern={aggressorPattern}
      >
        <simulation.pcbdriverreceiverchannel
          offset={offset}
          pattern={pattern}
          name="D81"
          driverDisabled={driverDisabled}
          driverRef={driverRef}
          receiverRef={receivers}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

test("full unrouted check reaches the segment after a series passive", async () => {
  await assert.rejects(
    renderSignals({ tree: <Board missing /> }),
    /is not routed between/,
  )
  // Render the gap with ideal routing allowed, then test the strict policy on the saved records.
  const circuit = await renderSignals({
    tree: <Board missing allowUnroutedTraces />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const channelSimulation = circuit.find(
    (record) => record.type === "simulation_pcb_transient_channel_simulation",
  )!
  if (channelSimulation.type !== "simulation_pcb_transient_channel_simulation")
    throw new Error("Missing channel simulation")
  channelSimulation.allow_unrouted_traces = false
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: inverterSources }),
    /is not routed between/,
  )
  const geometryOnly = circuit.filter(
    (record) => !record.type.endsWith("_error"),
  )
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit: geometryOnly,
        sources: inverterSources,
      }),
    /is not routed between/,
  )
  channelSimulation.allow_unrouted_traces = true
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  assert.equal(
    prepared.settings.traceContacts.length,
    1,
    "only the routed trace before RS is a channel trace",
  )
})

test("branched routed receiver arrays get the channel fanout diagnostic", async () => {
  const circuit = await renderSignals({ tree: <Board branch /> })
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: inverterSources }),
    {
      code: "channel_fanout",
      message: /branched routes are not supported yet/,
    },
  )
})

test("pipeline checks selected IBIS roles and disabled states after TSX rendering", async () => {
  const circuit = await renderSignals({ tree: <Board /> })
  const disabled = await renderSignals({ tree: <Board driverDisabled /> })
  const inputOnly = routedVisualIbis.replace(
    "Model_type Output",
    "Model_type Input",
  )
  const outputOnly = routedVisualIbis.replace(
    "Model_type Input",
    "Model_type Output",
  )
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit,
        sources: { [inverterIbisPath]: inputOnly },
      }),
    /Signal "D81".*LVC1G04_OUT_33.*does not support driving/,
  )
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit,
        sources: { [inverterIbisPath]: outputOnly },
      }),
    /Signal "D81".*LVC1G04_IN_33.*does not support receiving/,
  )
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit: disabled,
        sources: { [inverterIbisPath]: routedVisualIbis },
      }),
    /Signal "D81".*LVC1G04_OUT_33.*has no disabled state/,
  )
})

test("a disabled three-state driver still rejects a malformed literal pattern", async () => {
  const circuit = await renderSignals({
    tree: <Board driverDisabled pattern="10x" />,
  })
  const tristate = routedVisualIbis.replace(
    "Model_type Output",
    "Model_type 3-state",
  )
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit,
        sources: { [inverterIbisPath]: tristate },
      }),
    /pseudo-random binary sequence \(PRBS\)/,
  )
})

test("an unlisted output on the same net is diagnosed before routed branch checks", async () => {
  const circuit = await renderSignals({ tree: <Board extraDriver /> })
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit,
        sources: { [inverterIbisPath]: routedVisualIbis },
      }),
    /Signal "D81" has two drivers/,
  )
})

/** Give the second channel simulation its own source asset and a configurable distance from the first. */
function TwoIndependentChannelSimulations({
  otherY,
}: {
  otherY: number
}): React.JSX.Element {
  const board = TwoTraceBoard()
  return React.cloneElement(
    board,
    { height: 110 },
    <>
      {board.props.children}
      <Inverter
        name="OTHER_TX"
        x={-4.6}
        y={otherY}
        driver
        modelFile="distant.ibs"
      />
      <Inverter name="OTHER_RX" x={4.6} y={otherY} driver={false} />
      <trace
        from=".OTHER_TX > .Y"
        to=".OTHER_RX > .A"
        width={0.1}
        pcbPath={[".OTHER_TX > .Y", ".OTHER_RX > .A"]}
      />
      <simulation.pcbtransientchannelsimulation name="OTHER" bitRate="50Mbps">
        <simulation.pcbdriverreceiverchannel
          name="OTHER"
          driverRef=".OTHER_TX > .Y"
          receiverRef=".OTHER_RX > .A"
        />
      </simulation.pcbtransientchannelsimulation>
    </>,
  )
}

/** Prepare only the first channel simulation without the other board model's asset. */
async function prepareFirstChannelSimulation(
  otherY: number,
): Promise<PreparedChannelSimulation> {
  const circuit = await renderSignals({
    tree: <TwoIndependentChannelSimulations otherY={otherY} />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const first = listChannelSimulations(circuit).find(
    (channelSimulation) => channelSimulation.name === "TWO",
  )
  assert.ok(first)
  return prepareChannelSimulationById({
    circuit,
    sources: inverterSources,
    simulationPcbTransientChannelSimulationId:
      first.simulation_pcb_transient_channel_simulation_id,
    distanceMm: 1,
  })
}

test("preparing one channel simulation does not load assets for distant unretained pins", async () => {
  const prepared = await prepareFirstChannelSimulation(45)
  assert.equal(prepared.pins.size, 4)
  const paths = new Set(
    [...prepared.pins.values()].map(
      (pin) => pin.model.ibis_model_asset.project_relative_path,
    ),
  )
  assert.deepEqual([...paths], [inverterIbisPath])
})

test("preparation still loads IBIS assets for retained quiet pins", async () => {
  await assert.rejects(prepareFirstChannelSimulation(0.9), /distant[.]ibs/)
})

test("preparation omits a resistor array with a floating branch", async () => {
  const board = Board({ unlisted: true })
  const circuit = await renderSignals({
    tree: React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <chip
          name="ARRAY"
          pcbX={7}
          pcbY={1}
          connections={{ pin2: "net.GND" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={-0.3}
                pcbY={-0.25}
                width={0.25}
                height={0.25}
                shape="rect"
              />
              <smtpad
                portHints={["pin2"]}
                pcbX={0.3}
                pcbY={-0.25}
                width={0.25}
                height={0.25}
                shape="rect"
              />
              <smtpad
                portHints={["pin3"]}
                pcbX={-0.3}
                pcbY={0.25}
                width={0.25}
                height={0.25}
                shape="rect"
              />
              <smtpad
                portHints={["pin4"]}
                pcbX={0.3}
                pcbY={0.25}
                width={0.25}
                height={0.25}
                shape="rect"
              />
            </footprint>
          }
        >
          <spicemodel
            source={
              ".subckt ARRAY pin1 pin2 pin3 pin4\nR1 pin1 pin2 33\nR2 pin3 pin4 33\n.ends ARRAY"
            }
          />
        </chip>
        <trace
          from=".RX1 > .A"
          to=".ARRAY > .pin1"
          width={0.1}
          pcbPath={[".RX1 > .A", ".ARRAY > .pin1"]}
        />
      </>,
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const model = circuit.find(
    (record) => record.type === "simulation_spice_subcircuit",
  )
  assert.ok(model?.type === "simulation_spice_subcircuit")
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
    distanceMm: 1,
  })
  const retained = prepared.settings.copperScope.extractedSourceIds
  assert.ok(retained.includes(model.spice_pin_to_source_port_map.pin1))
  assert.deepEqual(prepared.settings.passiveComponents, [])
})

test("preparation keeps controls and probes independent across channel simulations", async () => {
  const board = TwoTraceBoard({ "data-pattern": "prbs7" })
  const circuit = await renderSignals({
    tree: React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <simulation.pcbtransientchannelsimulation
          name="ALT"
          bitRate="50Mbps"
          aggressorPattern="0"
        >
          <simulation.pcbdriverreceiverchannel
            name="A"
            driverRef=".TX0 > .Y"
            receiverRef=".RX0 > .A"
            pattern="prbs7"
            seed={42}
          />
        </simulation.pcbtransientchannelsimulation>
      </>,
    ),
  })
  const channels = circuit.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  const data = channels.find((channel) => channel.name === "DATA")
  assert.equal(data?.seed, 7)
  assert.equal(channels.find((channel) => channel.name === "A")?.seed, 42)
  assert.equal(
    channels.find((channel) => channel.name === "VICTIM")?.seed,
    undefined,
  )
  const [two, alt] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  assert.equal(two.channelSimulation.name, "TWO")
  assert.equal(alt.channelSimulation.name, "ALT")
  assert.deepEqual(Object.keys(two.controls), [
    two.channelSimulation.simulation_pcb_transient_channel_simulation_id,
  ])
  assert.deepEqual(Object.keys(alt.controls), [
    alt.channelSimulation.simulation_pcb_transient_channel_simulation_id,
  ])
  const [twoPlan] = generalDeclarations(declarationInput(two)).plans
  const [altPlan] = generalDeclarations(declarationInput(alt)).plans
  assert.deepEqual(
    twoPlan.stimuli.map((stimulus) => stimulus.name),
    ["DATA", "VICTIM"],
  )
  assert.equal(
    altPlan.stimuli.find((stimulus) => stimulus.name === "DATA"),
    undefined,
  )
  const alternate = altPlan.stimuli.find((stimulus) => stimulus.name === "A")
  assert.ok(alternate)
  assert.notEqual(
    twoPlan.stimuli[0].transmission_pattern.bits,
    alternate.transmission_pattern.bits,
  )
  const [dataSignal, victim] = two.driverReceiverChannels
  assert.deepEqual(
    twoPlan.probes.map((probe) => [probe.name, probe.signalSourceId]),
    [
      ["DATA_0", endpointPorts(dataSignal.receivers[0])[0]],
      ["VICTIM_0", endpointPorts(victim.receivers[0])[0]],
      ["VICTIM_1", endpointPorts(victim.driver)[0]],
    ],
  )
  assert.deepEqual(
    altPlan.probes.map((probe) => probe.name),
    ["A_0"],
  )
})

test("the aggressor drives the declared low and the listed driver receives a legal seed", async () => {
  const circuit = await renderSignals({ tree: <Board unlisted /> })
  const prepared = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })[0]
  assert.equal(prepared.driverReceiverChannels[0].seed, 127)
  const { driver } = prepared.driverReceiverChannels[0]
  let listedPort = ""
  if ("source_port_id" in driver) listedPort = driver.source_port_id
  const extra = [...prepared.pins.values()].find(
    (pin) => pin.buffer.type === "output" && pin.port !== listedPort,
  )!
  const { states, stimuli } =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  assert.equal(
    states.find((state) => state.source_port_id === extra.port)
      ?.is_output_enabled,
    true,
  )
  assert.equal(
    stimuli.find((stimulus) => stimulus.source_port_id === extra.port)
      ?.transmission_pattern.bits,
    "0",
  )
})

test("via plating comes from the preset and must be in the stackup", async () => {
  const circuit = await renderSignals({ tree: <Board via /> })
  const stack = circuit.find((record) => record.type === "pcb_stackup")!
  if (stack.type !== "pcb_stackup") throw new Error("Missing stackup")
  assert.equal(stack.plated_hole_copper_thickness, 0.018)
  assert.ok(
    prepareChannelSimulations({ circuit, sources: inverterSources })[0].settings
      .copperScope.extractedPcbViaIds.length >= 2,
  )
  delete stack.plated_hole_copper_thickness
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: inverterSources }),
    /pcb_stackup must specify plated_hole_copper_thickness/,
  )
  stack.plated_hole_copper_thickness = 0.025
  assert.doesNotThrow(() =>
    prepareChannelSimulations({ circuit, sources: inverterSources }),
  )
})

type DeclarationInput = Parameters<typeof generalDeclarations>[0]

/** Read each prepared trace’s declared endpoints. */
function declarationInput(
  prepared: PreparedChannelSimulation,
): DeclarationInput {
  return {
    circuit: prepared.circuit,
    receiverPaths: prepared.settings.traceContacts.map((contacts) => ({
      ...contacts,
      channelName: contacts.sourceTraceId,
    })),
    modeling: prepared.settings,
    controls: prepared.controls,
  }
}

test("preparation preserves a declared 2.8 V supply on a retained rail", async () => {
  const board = TwoTraceBoard()
  const circuit = await renderSignals({
    tree: React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <voltagesource
          name="REG"
          voltage={2.8}
          connections={{ pin1: "net.VCC", pin2: "net.GND" }}
        />
        <net name="OTHER" />
        <voltagesource
          name="UNRELATED"
          voltage={1.8}
          connections={{ pin1: "net.OTHER", pin2: "net.GND" }}
        />
      </>,
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
    distanceMm: 1,
  })
  const physical = prepared.circuit.filter(
    (record) => record.type === "simulation_voltage_source",
  )
  assert.deepEqual(
    physical.map((source) => source.voltage),
    [2.8],
  )
  assert.deepEqual(prepared.settings.supplies ?? [], [])
  const input = declarationInput(prepared)
  const { nodes } = generalDeclarations(input)
  const { lines } = electricalSources({
    circuit: input.circuit,
    modeling: input.modeling,
    nodes,
  })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^VPHYSICAL0 n[0-9]+ 0 2[.]8$/)
})

test("preparation biases a distinct 1.8 V power clamp reference", async () => {
  const circuit = await renderSignals({
    tree: <Board clampNet="net.PC" />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: { [inverterIbisPath]: separateClampIbis },
  })
  const input = declarationInput(prepared)
  const { nodes } = generalDeclarations(input)
  const { grounded, lines } = electricalSources({
    circuit: input.circuit,
    modeling: input.modeling,
    nodes,
  })
  const clamp = circuit.find(
    (record) => record.type === "source_net" && record.name === "PC",
  )
  assert.ok(clamp?.type === "source_net")
  const clampNode = nodes.node(clamp.source_net_id)
  assert.ok(grounded.has(clampNode))
  assert.equal(
    lines.filter((line) => line.endsWith(` ${clampNode} 0 1.8`)).length,
    1,
  )
})

test("preparation rejects incompatible typical voltages on one reference rail", async () => {
  const circuit = await renderSignals({
    tree: <Board clampNet="net.VCC" />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const sources = { [inverterIbisPath]: separateClampIbis }
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources }),
    /shared reference has incompatible/,
  )
})

test("a routed differential termination shares the receiver endpoint on each leg", async () => {
  const circuit = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  const input = declarationInput(prepared)
  const { nodes, plans } = generalDeclarations(input)
  assert.equal(input.receiverPaths.length, 4)
  const [positive, negative] = endpointPorts(
    prepared.driverReceiverChannels[0].receivers[0],
  )
  assert.ok(negative)
  for (const port of [positive, negative]) {
    assert.equal(
      input.receiverPaths.filter(
        (channelTrace) =>
          channelTrace.fromSourcePortId === port ||
          channelTrace.toSourcePortId === port,
      ).length,
      2,
    )
  }
  const { lines } = electricalSources({
    circuit: input.circuit,
    modeling: input.modeling,
    nodes,
  })
  assert.ok(
    lines.some((line) => line.startsWith("RPHYSICAL") && line.endsWith(" 120")),
  )
  assert.equal(plans[0].probes[0].signalNode, nodes.node(positive))
  assert.equal(plans[0].probes[0].referenceNode, nodes.node(negative))
})

test("PRBS31 generates exactly 65536 intervals for this duration", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="prbs31" duration={65_536 / 20e6} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.equal(plan.stimuli[0].transmission_pattern.bits.length, 65_536)
})

test("the default capture accepts a quiet driver whose offset is past the end", async () => {
  const automatic = await renderSignals({
    tree: <Board pattern="0" offset={3e-6} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit: automatic,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.equal(plan.durationSeconds, 1 / 20e6)
})

test("a constant driver with an in-range offset starts at zero", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="111" offset={0.5e-6} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.equal(plan.stimuli[0].start_time_ms, 0)
})

test("an explicit capture accepts a constant driver with a late offset and starts it at zero", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="0" offset={3e-6} duration={1e-6} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.equal(plan.stimuli[0].start_time_ms, 0)
})

test("a switching driver keeps its nonzero offset", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="01" offset={0.5} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.equal(plan.stimuli[0].start_time_ms, 500)
})

test("capture timing rejects a switching driver whose offset is past the end", async () => {
  const explicit = await renderSignals({
    tree: <Board pattern="01" offset={3e-6} duration={1e-6} />,
  })
  assert.throws(
    () =>
      prepareChannelSimulations({
        circuit: explicit,
        sources: inverterSources,
      }),
    /stimulus starts after/,
  )
})

test("an invalid repeated pattern is rejected even with an offset past the capture", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="xxx" offset={3e-6} duration={1e-6} />,
  })
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: inverterSources }),
    /pattern must be/,
  )
})

test("capture timing limits the maximum timestep for a 1 ps recording", async () => {
  const circuit = await renderSignals({
    tree: <Board pattern="01" duration={1e-12} />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  const [plan] = generalDeclarations(declarationInput(prepared)).plans
  assert.ok(plan.maxStepSeconds < plan.durationSeconds)
})

test("preparation does not add empty warnings to results or errors", async () => {
  const circuit = await renderSignals({ tree: <Board /> })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  assert.equal(Object.hasOwn(prepared, "warnings"), false)
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: {} }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.equal(Object.hasOwn(error, "warnings"), false)
      return true
    },
  )
})

test("the removed modeling API cannot supply a test or synthesize a channel simulation", () => {
  assert.deepEqual(listChannelSimulations([]), [])
})

test("explicit duration converts to ms and automatic duration stays absent", async () => {
  const automatic = await renderSignals({ tree: <Board /> })
  const automaticChannelSimulation = automatic.find(
    (record) => record.type === "simulation_pcb_transient_channel_simulation",
  )
  assert.equal(automaticChannelSimulation?.duration_ms, undefined)
  assert.equal(
    prepareChannelSimulations({
      circuit: automatic,
      sources: inverterSources,
    })[0].durationSeconds,
    127 / 20e6,
  )

  const explicit = await renderSignals({ tree: <Board duration={1e-9} /> })
  const [prepared] = prepareChannelSimulations({
    circuit: explicit,
    sources: inverterSources,
  })
  assert.ok(Math.abs(prepared.durationSeconds - 1e-9) <= Number.EPSILON * 1e-9)
  assert.ok(
    Math.abs((prepared.channelSimulation.duration_ms ?? NaN) - 1e-6) <=
      Number.EPSILON * 1e-6,
  )
})

test("numeric TSX offsets are seconds and precede one pattern period", async () => {
  const circuit = await renderSignals({ tree: <Board offset={0.5} /> })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: inverterSources,
  })
  assert.equal(prepared.driverReceiverChannels[0].offset_ms, 500)
  assert.ok(Math.abs(prepared.durationSeconds - (0.5 + 127 / 20e6)) < 1e-15)
})

test("source signal names use Unicode code point order", () => {
  assert.ok(compareNames({ a: "\uE000", b: "\u{10000}" }) < 0)
})
