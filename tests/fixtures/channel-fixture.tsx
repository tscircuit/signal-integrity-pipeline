import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type React from "react"
import { Inverter, Reference } from "./signal-parts"

type ChannelRouteScenario =
  | "series"
  | "unrouted"
  | "receiver-only"
  | "driver-only"
  | "parallel-passives"

/** A logical driver-to-receiver connection with optional series copper. */
export function ChannelFixture({
  route,
  namedNets = false,
  short,
  children,
}: {
  route: ChannelRouteScenario
  namedNets?: boolean
  children?: React.ReactNode
  short?: "resistor" | "channel" | "junction"
}): React.JSX.Element {
  const driver = ".TX > .Y"
  const receiver = ".RX > .A"
  const seriesInput = ".RS > .pin1"
  const seriesOutput = ".RS > .pin2"
  let driverPath: TraceProps["pcbPath"]
  if (route === "series" || route === "driver-only")
    driverPath = [driver, seriesInput]
  const join = ".JOIN > .A"
  let receiverStart = seriesOutput
  if (short === "junction") receiverStart = join
  let receiverPath: TraceProps["pcbPath"]
  if (route !== "driver-only") receiverPath = [receiverStart, receiver]
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
    >
      <Inverter name="TX" x={-5} y={0} driver />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <Reference />
      {children}
      {route === "unrouted" && <trace from={driver} to={receiver} />}
      {route === "parallel-passives" && (
        <ParallelPassives driver={driver} receiver={receiver} />
      )}
      {route !== "unrouted" && route !== "parallel-passives" && (
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
            from={driver}
            to={seriesInput}
            width={0.2}
            pcbPath={driverPath}
          />
          <trace
            from={receiverStart}
            to={receiver}
            width={0.2}
            pcbPath={receiverPath}
          />
        </>
      )}
      {short === "junction" && (
        <>
          <Inverter name="JOIN" x={2.5} y={0} driver={false} />
          <trace from={seriesOutput} to={join} />
          <trace from={seriesInput} to={join} />
        </>
      )}
      {short === "resistor" && <trace from={seriesInput} to={seriesOutput} />}
      {short === "channel" && <trace from={driver} to={receiver} />}
      {namedNets && (
        <>
          <trace from={driver} to="net.DRIVER" />
          <trace from={seriesInput} to="net.DRIVER" />
          <trace from={seriesOutput} to="net.RECEIVER" />
          <trace from={receiver} to="net.RECEIVER" />
        </>
      )}
      <simulation.pcbtransientchannelsimulation
        name="SERIES"
        bitRate="20Mbps"
        allowUnroutedTraces
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driver}
          receiverRef={receiver}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

/** One interior trace with two parallel passives on each side. */
function ParallelPassives({
  driver,
  receiver,
}: {
  driver: string
  receiver: string
}): React.JSX.Element {
  const left = ".R1 > .pin2"
  const right = ".R2 > .pin1"
  return (
    <>
      <resistor name="R1" resistance="33" footprint="0402" pcbX={-2} />
      <resistor name="R2" resistance="33" footprint="0402" pcbX={2} />
      <capacitor
        name="C1"
        capacitance="10pF"
        footprint="0402"
        pcbX={-2}
        pcbY={1}
      />
      <capacitor
        name="C2"
        capacitance="10pF"
        footprint="0402"
        pcbX={2}
        pcbY={1}
      />
      <trace from={driver} to=".R1 > .pin1" />
      <trace from={driver} to=".C1 > .pin1" />
      <trace from=".C1 > .pin2" to={left} />
      <trace from={left} to={right} pcbPath={[left, right]} />
      <trace from={right} to=".C2 > .pin1" />
      <trace from=".R2 > .pin2" to={receiver} />
      <trace from=".C2 > .pin2" to={receiver} />
    </>
  )
}
