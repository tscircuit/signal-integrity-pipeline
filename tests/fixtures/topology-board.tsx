import { Circuit, simulation } from "@tscircuit/core"
import type { PcbDriverReceiverChannelProps } from "@tscircuit/props"
import type { JSX, ReactNode } from "react"
import type {
  CircuitJson,
  SimulationPcbDriverReceiverChannel,
} from "../../src/board"

/** A component with one physical signal pin. */
export function SignalPin({
  name,
  x,
  y = 0,
  layer = "top",
  width = 0.4,
}: {
  name: string
  x: number
  y?: number
  layer?: "top" | "bottom"
  width?: number
}): JSX.Element {
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pcbY={y}
        layer={layer}
        pinLabels={{ pin1: "SIG" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={width}
              height={0.4}
              shape="rect"
            />
          </footprint>
        }
      />
      <SignalModel name={name} />
    </>
  )
}

const signalModelAsset = {
  project_relative_path: "device.ibs",
  url: "https://example.com/device.ibs",
  mimetype: "text/plain",
}

/** Declare a synthetic model so core can bind the channel endpoints. */
export function SignalModel({ name }: { name: string }): JSX.Element {
  return (
    <simulation.ibismodel
      componentRef={`.${name}`}
      ibisModelAsset={signalModelAsset}
      ibisComponentName="Device"
      ibisPinNameToPortLabel={{ 1: "SIG" }}
    />
  )
}

/** Rendered routes and the core-emitted channel under test. */
export type TopologyBoard = {
  circuit: CircuitJson
  signal: SimulationPcbDriverReceiverChannel
}

type TopologyBoardOptions = {
  children: ReactNode
  driverRef?: PcbDriverReceiverChannelProps["driverRef"]
  receiverRef?: PcbDriverReceiverChannelProps["receiverRef"]
}

/** Render manual routes without letting the autorouter fill deliberate gaps. */
async function renderTopologyBoard(children: ReactNode): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board
      width={25}
      height={25}
      layers={2}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {children}
    </board>,
  )
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}

/** Emit the channel while leaving strict routing checks to the test. */
export async function topologyBoard({
  children,
  driverRef = ".TX > .SIG",
  receiverRef = ".RX > .SIG",
}: TopologyBoardOptions): Promise<TopologyBoard> {
  const circuit = await renderTopologyBoard(
    <>
      {children}
      <simulation.pcbtransientchannelsimulation
        bitRate={1e9}
        allowUnroutedTraces
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driverRef}
          receiverRef={receiverRef}
          pattern="01"
        />
      </simulation.pcbtransientchannelsimulation>
    </>,
  )
  const signal = circuit.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  if (!signal) {
    const errors = circuit.filter((record) => record.type.endsWith("_error"))
    throw new Error(
      `Expected core to emit a topology fixture channel: ${JSON.stringify(errors)}`,
    )
  }
  return { circuit, signal }
}

/** A driver stub and a schematic receiver with no footprint. */
export async function missingReceiverTerminal({
  missing = "receiver",
}: {
  missing?: "driver" | "receiver"
} = {}): Promise<TopologyBoard> {
  const endpoints: Omit<TopologyBoardOptions, "children"> = {}
  if (missing === "driver") {
    endpoints.driverRef = ".RX > .SIG"
    endpoints.receiverRef = ".TX > .SIG"
  }
  return topologyBoard({
    ...endpoints,
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <chip name="RX" pcbX={4} pcbY={0} pinLabels={{ pin1: "SIG" }} />
        <SignalModel name="RX" />
        <net name="SIGNAL" />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 1, y: 0 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}

/** TX and RX are routed, while a same-net stub has no trace. */
export async function unroutedExtraPin({
  receiver,
}: {
  receiver: "RX" | "STUB"
}): Promise<TopologyBoard> {
  return topologyBoard({
    receiverRef: `.${receiver} > .SIG`,
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="STUB" x={0} y={4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace from=".TX > .SIG" to=".STUB > .SIG" />
      </>
    ),
  })
}

/** A straight route through a sampling pin, with an optional perpendicular branch. */
export async function daisyChain({
  receivers,
  branch = false,
}: {
  receivers: ("MID" | "RX")[]
  branch?: boolean
}): Promise<TopologyBoard> {
  return topologyBoard({
    receiverRef: receivers.map((name) => `.${name} > .SIG`),
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="MID" x={0} />
        <SignalPin name="RX" x={4} />
        <trace
          from=".TX > .SIG"
          to=".MID > .SIG"
          pcbPath={[".TX > .SIG", ".MID > .SIG"]}
        />
        <trace
          from=".MID > .SIG"
          to=".RX > .SIG"
          pcbPath={[".MID > .SIG", ".RX > .SIG"]}
        />
        {branch && (
          <>
            <SignalPin name="BRANCH" x={0} y={4} />
            <trace
              from=".MID > .SIG"
              to=".BRANCH > .SIG"
              pcbPath={[".MID > .SIG", ".BRANCH > .SIG"]}
            />
          </>
        )}
      </>
    ),
  })
}

/** One series resistor, optionally followed by a second copper leg to a test pin. */
export async function seriesResistor({
  stub = false,
}: {
  stub?: boolean
}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <resistor name="R" resistance="33" footprint="0402" pcbX={0} pcbY={0} />
        <trace
          from=".TX > .SIG"
          to=".R > .pin1"
          pcbPath={[".TX > .SIG", ".R > .pin1"]}
        />
        <trace
          from=".R > .pin2"
          to=".RX > .SIG"
          pcbPath={[".R > .pin2", ".RX > .SIG"]}
        />
        {stub && (
          <>
            <SignalPin name="TEST" x={1} y={4} />
            <trace
              from=".R > .pin2"
              to=".TEST > .SIG"
              pcbPath={[".R > .pin2", ".TEST > .SIG"]}
            />
          </>
        )}
      </>
    ),
  })
}

/** Top and bottom traces meet at a plated terminal. */
export async function platedHoleRoute(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <chip
          name="MID"
          pcbX={0}
          pcbY={0}
          pinLabels={{ pin1: "SIG" }}
          footprint={
            <footprint>
              <platedhole
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                shape="circle"
                holeDiameter={0.2}
                outerDiameter={0.4}
              />
            </footprint>
          }
        />
        <SignalModel name="MID" />
        <SignalPin name="RX" x={4} layer="bottom" />
        <trace
          from=".TX > .SIG"
          to=".MID > .SIG"
          pcbPath={[".TX > .SIG", ".MID > .SIG"]}
        />
        <trace
          from=".RX > .SIG"
          to=".MID > .SIG"
          pcbPath={[".RX > .SIG", ".MID > .SIG"]}
        />
      </>
    ),
  })
}

/** Top and bottom traces meet at a separately rendered via. */
export async function standaloneViaRoute({
  offset = 0,
  viaNet = "SIGNAL",
  viaPort,
}: {
  offset?: number
  viaNet?: string
  viaPort?: string
} = {}): Promise<TopologyBoard> {
  let connectsTo = `net.${viaNet}`
  if (viaPort) connectsTo = `.${viaPort} > .SIG`
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="SIGNAL" />
        {viaPort === "OTHER" && <SignalPin name="OTHER" x={0} y={4} />}
        {viaNet !== "SIGNAL" && <net name={viaNet} />}
        <via
          name="V"
          pcbX={0}
          pcbY={0}
          layers={["top", "bottom"]}
          holeDiameter={0.2}
          outerDiameter={0.45}
          connectsTo={connectsTo}
        />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4 - offset, y: 0 }]}
        />
        <trace
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -4 + offset, y: 0 }]}
        />
      </>
    ),
  })
}

/** Two connected same-layer traces cross again between their route vertices. */
export async function crossingRoute({
  thirdLayer = "top",
}: {
  thirdLayer?: "top" | "bottom"
} = {}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="END" x={0} y={4} layer={thirdLayer} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".END > .SIG"
          to=".RX > .SIG"
          pcbPath={[".END > .SIG", { x: 0, y: -8 }, ".RX > .SIG"]}
        />
      </>
    ),
  })
}

/** A named-net trace ends at x = 3.86 mm near the edge of the receiver pad. */
export async function padContactRoute({
  offset,
  layer = "top",
}: {
  offset: number
  layer?: "top" | "bottom"
}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer={layer} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 2, y: offset }, { x: 7.86, y: offset }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}

/** Two copper paths each pass through a pad of a cross-leg termination load. */
export async function differentialTerminationRoute({
  positiveTerminal = "pin1",
}: {
  positiveTerminal?: "pin1" | "pin2"
} = {}): Promise<TopologyBoard> {
  const reversed = positiveTerminal === "pin2"
  const positive = `.TERM > .${positiveTerminal}`
  let negative = ".TERM > .pin2"
  let rotation = 90
  if (reversed) {
    negative = ".TERM > .pin1"
    rotation = -90
  }
  return topologyBoard({
    driverRef: { p: ".TXP > .SIG", n: ".TXN > .SIG" },
    receiverRef: { p: ".RXP > .SIG", n: ".RXN > .SIG" },
    children: (
      <>
        <SignalPin name="TXP" x={-4} y={-0.825} />
        <SignalPin name="TXN" x={-4} y={0.825} />
        <SignalPin name="RXP" x={4} y={-0.825} />
        <SignalPin name="RXN" x={4} y={0.825} />
        <resistor
          name="TERM"
          resistance="120"
          footprint="0603"
          pcbRotation={rotation}
        />
        <trace
          from=".TXP > .SIG"
          to={positive}
          pcbPath={[".TXP > .SIG", positive]}
        />
        <trace
          from={positive}
          to=".RXP > .SIG"
          pcbPath={[positive, ".RXP > .SIG"]}
        />
        <trace
          from=".TXN > .SIG"
          to={negative}
          pcbPath={[".TXN > .SIG", negative]}
        />
        <trace
          from={negative}
          to=".RXN > .SIG"
          pcbPath={[negative, ".RXN > .SIG"]}
        />
      </>
    ),
  })
}
