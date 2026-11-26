import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import React from "react"
import { routedVisualIbis } from "../fixtures/routed-visual-fixture"
import { Inverter, Reference } from "../fixtures/signal-parts"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../fixtures/signal-render"

/** The unmodelled three-pad copper is physically far from DATA, on the same real board. */
function Board({
  unrelatedY = 20,
  neighbour = false,
  termination = false,
}: {
  unrelatedY?: number
  neighbour?: boolean
  termination?: boolean
}): React.JSX.Element {
  return (
    <board
      width={24}
      height={60}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      <Inverter name="TX" x={-5} y={0} driver />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <Reference />
      {neighbour && (
        <>
          <Inverter name="QUIET_TX" x={-5} y={0.8} driver />
          <Inverter name="QUIET_RX" x={5} y={0.8} driver={false} />
          <trace
            from=".QUIET_TX > .Y"
            to=".QUIET_RX > .A"
            width={0.2}
            pcbPath={[".QUIET_TX > .Y", ".QUIET_RX > .A"]}
          />
        </>
      )}
      {termination && (
        <>
          <resistor
            name="QUIET_TERM"
            resistance={50}
            pcbX={7}
            pcbY={0.8}
            connections={{ pin2: "net.GND" }}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={-0.2}
                  pcbY={0}
                  width={0.25}
                  height={0.25}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin2"]}
                  pcbX={0.2}
                  pcbY={0}
                  width={0.25}
                  height={0.25}
                  shape="rect"
                />
              </footprint>
            }
          />
          <trace
            from=".QUIET_RX > .A"
            to=".QUIET_TERM > .pin1"
            width={0.1}
            pcbPath={[".QUIET_RX > .A", ".QUIET_TERM > .pin1"]}
          />
        </>
      )}
      <trace
        from=".TX > .Y"
        to=".RX > .A"
        width={0.2}
        pcbPath={[".TX > .Y", ".RX > .A"]}
      />
      <chip
        name="UNRELATED"
        pcbY={unrelatedY}
        pinLabels={{ pin1: "A", pin2: "B", pin3: "C" }}
        footprint={
          <footprint>
            {[1, 2, 3].map((pin) => (
              <React.Fragment key={pin}>
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbX={pin}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </React.Fragment>
            ))}
          </footprint>
        }
      />
      <trace
        path={[".UNRELATED > .A", ".UNRELATED > .B", ".UNRELATED > .C"]}
        width={0.2}
        pcbPaths={[
          [".UNRELATED > .A", ".UNRELATED > .B"],
          [".UNRELATED > .B", ".UNRELATED > .C"],
        ]}
      />
      <pcbnotetext
        text="DATA at y=0; unrelated branched copper at y=20 mm"
        pcbY={25}
        pcbX={0}
      />
      <simulation.pcbtransientchannelsimulation
        name="SCOPED"
        bitRate="20Mbps"
        aggressorPattern="0"
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef=".TX > .Y"
          receiverRef=".RX > .A"
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

test("unrelated branched copper cannot reject a selected channel", async () => {
  const circuit = await renderSignals({ tree: <Board /> })
  const sources = { "models/sn74lvc1g04.ibs": routedVisualIbis }
  const [channelSimulation] = prepareChannelSimulations({
    circuit,
    sources,
    distanceMm: 1,
  })
  assert.equal(channelSimulation.settings.traceContacts.length, 1)
  const retained = new Set(
    channelSimulation.settings.copperScope.extractedPcbTraceIds,
  )
  const excluded = circuit.filter(
    (record) =>
      record.type === "pcb_trace" && !retained.has(record.pcb_trace_id),
  )
  assert.equal(excluded.length, 2)
  const near = prepareChannelSimulations({
    circuit: await renderSignals({ tree: <Board neighbour /> }),
    sources,
    distanceMm: 1,
  })[0]
  assert.equal(
    near.settings.traceContacts.length,
    1,
    "only the selected channel is a lane",
  )
  const { extractedPcbTraceIds, channelPcbTraceIds } = near.settings.copperScope
  assert.ok(
    extractedPcbTraceIds.length > channelPcbTraceIds.length,
    "the nearby quiet conductor stays in the copper scope",
  )
  const quiet = [...near.pins.values()].find((pin) => {
    if (pin.buffer.type !== "output") return false
    return !near.driverReceiverChannels.some(
      ({ driver }) =>
        "source_port_id" in driver && driver.source_port_id === pin.port,
    )
  })!
  const { stimuli } =
    near.controls[
      near.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  const quietStimulus = stimuli.some((stimulus) => {
    return (
      stimulus.source_port_id === quiet.port &&
      stimulus.transmission_pattern.bits === "0"
    )
  })
  assert.ok(quietStimulus)
  const nearbyBranch = await renderSignals({ tree: <Board unrelatedY={0.5} /> })
  const branched = prepareChannelSimulations({
    circuit: nearbyBranch,
    sources,
    distanceMm: 1,
  })[0]
  assert.equal(
    branched.settings.traceContacts.length,
    1,
    "nearby branched copper is a scoped neighbour, not a rejected lane",
  )
  assert.ok(
    branched.settings.copperScope.extractedPcbTraceIds.length >
      branched.settings.copperScope.channelPcbTraceIds.length,
  )
})

test("a shunt on retained quiet copper remains a modeled load", async () => {
  const circuit = await renderSignals({
    tree: <Board neighbour termination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const sources = { "models/sn74lvc1g04.ibs": routedVisualIbis }
  const [channelSimulation] = prepareChannelSimulations({
    circuit,
    sources,
    distanceMm: 1,
  })
  const termination = circuit.find(
    (record) =>
      record.type === "source_component" && record.name === "QUIET_TERM",
  )
  assert.ok(termination?.type === "source_component")
  const signalPort = circuit.find(
    (record) =>
      record.type === "source_port" &&
      record.source_component_id === termination.source_component_id &&
      record.pin_number === 1,
  )
  assert.ok(signalPort?.type === "source_port")
  const trace = circuit.find(
    (record) =>
      record.type === "source_trace" &&
      record.connected_source_port_ids.includes(signalPort.source_port_id),
  )
  assert.ok(trace?.type === "source_trace")
  const route = circuit.find(
    (record) =>
      record.type === "pcb_trace" &&
      record.source_trace_id === trace.source_trace_id,
  )
  assert.ok(route?.type === "pcb_trace")
  assert.ok(
    channelSimulation.settings.copperScope.extractedPcbTraceIds.includes(
      route.pcb_trace_id,
    ),
  )
  assert.deepEqual(channelSimulation.settings.passiveComponents, [
    { sourceComponentId: termination.source_component_id },
  ])
})
