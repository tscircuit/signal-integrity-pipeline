import { simulation } from "@tscircuit/core"
import type React from "react"
import { Fragment } from "react"
import type { RunControls } from "../../src/simulation"
import { routedVisualIbis } from "./routed-visual-fixture"
import { Reference } from "./signal-parts"
import { prepareChannelSimulations, renderSignals } from "./signal-render"

const asset = {
  project_relative_path: "fixture-parallel-bus.ibs",
  url: "./fixture-parallel-bus.ibs",
  mimetype: "text/plain",
}
const pins = { 1: "DQ0", 2: "DQ1", 3: "OE_N", 4: "GND", 5: "VCC" }
const output = routedVisualIbis
  .split("[Model] LVC1G04_OUT_33")[1]
  .split("[Model] LVC1G04_IN_33")[0]

export const parallelBusSources = {
  [asset.project_relative_path]: routedVisualIbis
    .replace("LVC1G04_DCK", "ParallelBus")
    .replace(
      "2 A LVC1G04_IN_33\n3 GND GND\n4 Y LVC1G04_OUT_33\n5 VCC POWER",
      "1 DQ0 Bidirectional\n2 DQ1 DATA_MODELS\n3 OE_N LVC1G04_IN_33\n4 GND GND\n5 VCC POWER",
    )
    .replace(
      "[Model] LVC1G04_OUT_33",
      `[Model Selector] DATA_MODELS
LVC1G04_OUT_33 Bus output
LVC1G04_IN_33 Bus input
[Model] LVC1G04_OUT_33`,
    )
    .replace(
      "[End]",
      `[Model] Bidirectional${output.replace("Model_type Output", "Model_type I/O")}[End]`,
    ),
}

export const threeStateParallelBusSources = {
  [asset.project_relative_path]: parallelBusSources[
    asset.project_relative_path
  ].replace("Model_type Output", "Model_type 3-state"),
}

const padPositions = [
  { pin: "1", y: 0 },
  { pin: "2", y: 0.5 },
  { pin: "3", y: 1 },
  { pin: "4", y: -3.5 },
  { pin: "5", y: 2.5 },
]
const references = {
  pullup: "VCC",
  pulldown: "GND",
  powerClamp: "VCC",
  groundClamp: "GND",
}

/** A two-bit bus part with a bidirectional pin, a dedicated data pin and an enable input. */
function BusPart({
  name,
  x,
}: {
  name: "TX" | "RX"
  x: number
}): React.JSX.Element {
  let dataModel = "LVC1G04_OUT_33"
  if (name === "RX") dataModel = "LVC1G04_IN_33"
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pinLabels={Object.fromEntries(
          Object.entries(pins).map(([pin, label]) => [`pin${pin}`, label]),
        )}
        connections={{ GND: "net.GND", VCC: "net.VCC" }}
        footprint={
          <footprint>
            {padPositions.map(({ pin, y }) => (
              <Fragment key={pin}>
                <smtpad
                  portHints={[`pin${pin}`]}
                  pcbY={y}
                  width={0.25}
                  height={0.25}
                  shape="rect"
                />
              </Fragment>
            ))}
          </footprint>
        }
      />
      <via
        name={`G_${name}`}
        pcbX={x}
        pcbY={-3.5}
        fromLayer="top"
        toLayer="bottom"
        holeDiameter={0.15}
        outerDiameter={0.3}
        connectsTo={`.${name} > .GND`}
      />
      <simulation.ibismodel
        componentRef={`.${name}`}
        ibisModelAsset={asset}
        ibisComponentName="ParallelBus"
        ibisPinNameToPortLabel={pins}
        ibisPinNameToModelName={{ 1: "Bidirectional", 2: dataModel }}
        ibisPinNameToReferencePortLabels={{ 1: references, 2: references }}
      />
    </>
  )
}

/** Route both physical neighbors and let the caller choose which to declare as drivers. */
export function ParallelBus({
  children,
  simulationName,
  neighbourPattern,
  driverDisabled,
  driverBitRate,
  aggressorPattern,
  aggressorDisabled,
  duration,
}: {
  children?: React.ReactNode
  simulationName?: string
  neighbourPattern?: "1"
  driverDisabled?: boolean
  driverBitRate?: string
  aggressorPattern?: string
  aggressorDisabled?: boolean
  duration?: string
}): React.JSX.Element {
  return (
    <board
      width={18}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      schematicDisabled
      routeRemaining={false}
      isViaInPadAllowed
    >
      <BusPart name="TX" x={-5} />
      <BusPart name="RX" x={5} />
      <Reference />
      {children}
      {["DQ0", "DQ1"].map((pin) => (
        <Fragment key={pin}>
          <trace
            from={`.TX > .${pin}`}
            to={`.RX > .${pin}`}
            pcbPath={[`.TX > .${pin}`, `.RX > .${pin}`]}
            width={0.2}
          />
        </Fragment>
      ))}
      <simulation.pcbtransientchannelsimulation
        name={simulationName}
        bitRate="20Mbps"
        aggressorPattern={aggressorPattern}
        aggressorDisabled={aggressorDisabled}
        duration={duration}
      >
        <simulation.pcbdriverreceiverchannel
          name="DQ0"
          driverRef=".TX > .DQ0"
          receiverRef=".RX > .DQ0"
          driverDisabled={driverDisabled}
          bitRate={driverBitRate}
          pattern="01"
        />
        {neighbourPattern && (
          <simulation.pcbdriverreceiverchannel
            name="DQ1"
            driverRef=".TX > .DQ1"
            receiverRef=".RX > .DQ1"
            pattern={neighbourPattern}
          />
        )}
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

/** Capture timing and lowered controls for the bus's DQ1 aggressor. */
interface ParallelBusAggressorControls {
  durationSeconds: number
  state: RunControls["states"][number] | undefined
  stimulus: RunControls["stimuli"][number] | undefined
}

/** Render the bus through core and read the controls for TX.DQ1. */
export async function parallelBusAggressorControls({
  tree,
  sources = parallelBusSources,
}: {
  tree: React.JSX.Element
  sources?: typeof parallelBusSources
}): Promise<ParallelBusAggressorControls> {
  const circuit = await renderSignals({ tree })
  const [prepared] = prepareChannelSimulations({ circuit, sources })
  const aggressor = [...prepared.pins.values()].find(
    (pin) => pin.pin === "2" && pin.buffer.type !== "input",
  )
  const { states, stimuli } =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  return {
    durationSeconds: prepared.durationSeconds,
    state: states.find((state) => state.source_port_id === aggressor?.port),
    stimulus: stimuli.find(
      (stimulus) => stimulus.source_port_id === aggressor?.port,
    ),
  }
}
