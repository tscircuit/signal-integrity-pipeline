import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type React from "react"
import { Inverter, Reference } from "./signal-parts"

type Route = "series" | "unrouted" | "receiver-only"

/** A logical driver-to-receiver connection with optional series copper. */
export function AdmissionChannel({
  route,
}: {
  route: Route
}): React.JSX.Element {
  const driver = ".TX > .Y"
  const receiver = ".RX > .A"
  const seriesInput = ".RS > .pin1"
  const seriesOutput = ".RS > .pin2"
  let driverPath: TraceProps["pcbPath"]
  if (route === "series") driverPath = [driver, seriesInput]
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
      {route === "unrouted" && <trace from={driver} to={receiver} />}
      {route !== "unrouted" && (
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
            from={seriesOutput}
            to={receiver}
            width={0.2}
            pcbPath={[seriesOutput, receiver]}
          />
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
