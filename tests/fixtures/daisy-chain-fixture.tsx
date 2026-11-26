import { simulation } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import { Fragment, type JSX, type ReactNode } from "react"
import { Inverter, Reference } from "./signal-parts"

/** Two modeled inputs on one straight signal with a routed or ideal final leg. */
export function DaisyChainFixture({
  routeFinalLeg,
  boardWidthMm = 18,
  allowBlindAndBuriedVias = false,
  namedNet = false,
  bypassFinalLeg = false,
  idealMiddleLeg = false,
  branched = false,
  placedLoad = false,
  children,
}: {
  routeFinalLeg: boolean
  boardWidthMm?: number
  allowBlindAndBuriedVias?: boolean
  namedNet?: boolean | "ends" | "multipoint"
  bypassFinalLeg?: boolean
  idealMiddleLeg?: boolean
  branched?: boolean
  placedLoad?: boolean | "mapped"
  children?: ReactNode
}): JSX.Element {
  const driver = ".TX > .Y"
  const middleReceiver = ".MID > .A"
  const finalReceiver = ".RX > .A"
  let finalLegStart = middleReceiver
  if (idealMiddleLeg) finalLegStart = ".JOIN > .A"
  let finalPcbPath: TraceProps["pcbPath"]
  const receiverRefs = [middleReceiver]
  const branchStart = ".BRANCH > .A"
  const branchReceiver = ".RX2 > .A"
  if (branched) receiverRefs.push(branchReceiver)
  let namedPorts = [driver, finalReceiver]
  if (namedNet === "multipoint") namedPorts = [driver]
  if (namedNet === true)
    namedPorts = [
      ...new Set([driver, middleReceiver, finalLegStart, finalReceiver]),
    ]
  let loadPort = ".LOAD > .pin3"
  if (placedLoad === "mapped") loadPort = ".LOAD > .pin1"
  if (routeFinalLeg) finalPcbPath = [finalLegStart, finalReceiver]
  if (!routeFinalLeg || idealMiddleLeg || namedNet === "ends")
    receiverRefs.push(finalReceiver)

  return (
    <board
      width={boardWidthMm}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias={allowBlindAndBuriedVias}
      isViaInPadAllowed
    >
      <Inverter name="TX" x={-5} y={0} driver />
      <Inverter name="MID" x={0} y={0} driver={false} />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <Reference />
      {children}
      {idealMiddleLeg && (
        <>
          <Inverter name="JOIN" x={2.5} y={0} driver={false} />
          {namedNet === "multipoint" && (
            <trace path={[middleReceiver, finalLegStart, "net.DATA"]} />
          )}
          {namedNet !== "multipoint" && (
            <trace from={middleReceiver} to={finalLegStart} />
          )}
        </>
      )}
      <trace
        from={driver}
        to={middleReceiver}
        width={0.2}
        pcbPath={[driver, middleReceiver]}
      />
      <trace
        from={finalLegStart}
        to={finalReceiver}
        width={0.2}
        pcbPath={finalPcbPath}
      />
      {bypassFinalLeg && (
        <>
          <trace from={driver} to={finalReceiver} />
          <pcbnotetext
            text="TX.Y and RX.A joined by an ideal bypass across both traces"
            pcbX={0}
            pcbY={4.8}
          />
        </>
      )}
      {branched && (
        <>
          <Inverter name="BRANCH" x={0} y={1} driver={false} />
          <Inverter name="RX2" x={5} y={1} driver={false} />
          <trace from={middleReceiver} to={branchStart} />
          <trace
            from={branchStart}
            to={branchReceiver}
            width={0.2}
            pcbPath={[branchStart, branchReceiver]}
          />
        </>
      )}
      {placedLoad && (
        <>
          <chip
            name="LOAD"
            pcbX={7}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={0}
                  pcbY={0.6}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin2"]}
                  pcbX={0.6}
                  pcbY={0.6}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin3"]}
                  pcbX={0}
                  pcbY={0}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </footprint>
            }
          >
            <spicemodel
              source={".subckt LOAD pin1 pin2\nR1 pin1 pin2 33\n.ends LOAD"}
            />
          </chip>
          <trace
            from={finalReceiver}
            to={loadPort}
            width={0.2}
            pcbPath={[finalReceiver, loadPort]}
          />
        </>
      )}
      {namedNet &&
        namedPorts.map((port) => (
          <Fragment key={port}>
            <trace from={port} to="net.DATA" />
          </Fragment>
        ))}
      <simulation.pcbtransientchannelsimulation
        name="DAISY"
        bitRate="20Mbps"
        allowUnroutedTraces={!routeFinalLeg || idealMiddleLeg || bypassFinalLeg}
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef={driver}
          receiverRef={receiverRefs}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
