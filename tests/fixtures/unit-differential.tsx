// Topology/transient unit-test source only.
import { simulation } from "@tscircuit/core"
import type { ResistorProps } from "@tscircuit/props"
import { Fragment, type JSX, type ReactNode } from "react"
import { Reference, Transceiver } from "./signal-parts"

/** Differential test rate in bits per second. */
const BIT_RATE_BPS = 250e3

/** Capture this many bits from the differential channel. */
const CAPTURE_BITS = 48

/** Build an RS-485 channel, optionally swapping the differential pin order. */
export default function ({
  reversed = false,
  routedTermination = false,
  short,
  seriesPositive = false,
  internalShort = false,
  allowUnroutedTraces,
  partialSeriesPair = false,
  openPositive = false,
  directNegative = false,
  children,
  additionalChannels,
}: {
  reversed?: boolean
  routedTermination?: boolean | "positive"
  short?: "TX" | "RX" | "RTERM" | "series" | "interior"
  seriesPositive?: boolean
  internalShort?: boolean
  allowUnroutedTraces?: boolean
  openPositive?: boolean
  directNegative?: boolean
  children?: ReactNode
  additionalChannels?: ReactNode
  partialSeriesPair?: boolean
}): JSX.Element {
  let positive = "A"
  let negative = "B"
  if (reversed) {
    positive = "B"
    negative = "A"
  }
  let terminationX = 5
  let connections: ResistorProps["connections"] = {
    pin1: ".RX > .A",
    pin2: ".RX > .B",
  }
  if (routedTermination) {
    terminationX = 7
    connections = undefined
  }
  const driverRef = { p: `.TX > .${positive}`, n: `.TX > .${negative}` }
  const receiverRef = { p: `.RX > .${positive}`, n: `.RX > .${negative}` }
  const receiverInternalTies = []
  if (internalShort) receiverInternalTies.push(["pin6", "pin7"])
  return (
    <board
      width={20}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      <Transceiver name="TX" x={-5} />
      <Transceiver
        name="RX"
        x={5}
        internallyConnectedPins={receiverInternalTies}
      />
      <Reference />
      {children}
      {partialSeriesPair && (
        <>
          <PartialSeriesLeg pin="A" y={1.5} />
          {!directNegative && <PartialSeriesLeg pin="B" y={-1.5} />}
        </>
      )}
      {!partialSeriesPair &&
        !openPositive &&
        (seriesPositive ? (
          <DualTerminatedPositiveLeg />
        ) : (
          <trace
            from=".TX > .A"
            to=".RX > .A"
            width={0.2}
            pcbPath={[".TX > .A", ".RX > .A"]}
          />
        ))}
      {(!partialSeriesPair || directNegative) && (
        <trace
          from=".TX > .B"
          to=".RX > .B"
          width={0.2}
          pcbPath={[".TX > .B", ".RX > .B"]}
        />
      )}
      <resistor
        name="RTERM"
        resistance="120"
        pcbX={terminationX}
        connections={connections}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={0}
              pcbY={-0.3}
              width={0.25}
              height={0.25}
              shape="rect"
            />
          </footprint>
        }
      />
      {routedTermination && (
        <>
          <trace
            from=".RX > .A"
            to=".RTERM > .pin1"
            width={0.2}
            pcbPath={[".RX > .A", ".RTERM > .pin1"]}
          />
          {routedTermination === true && (
            <trace
              from=".RX > .B"
              to=".RTERM > .pin2"
              width={0.2}
              pcbPath={[".RX > .B", ".RTERM > .pin2"]}
            />
          )}
          {routedTermination === "positive" && (
            <trace from=".RX > .B" to=".RTERM > .pin2" />
          )}
        </>
      )}
      {short === "interior" && <trace from=".RA1 > .pin2" to=".RB1 > .pin2" />}
      {short === "series" && <trace from=".RS1 > .pin2" to=".TX > .B" />}
      {short === "TX" && <trace from=".TX > .A" to=".TX > .B" />}
      {short === "RX" && <trace from=".RX > .A" to=".RX > .B" />}
      {short === "RTERM" && <trace from=".RTERM > .pin1" to=".RTERM > .pin2" />}
      <simulation.pcbtransientchannelsimulation
        name="RS485"
        aggressorDisabled
        allowUnroutedTraces={allowUnroutedTraces}
        bitRate={BIT_RATE_BPS}
        duration={CAPTURE_BITS / BIT_RATE_BPS}
      >
        <simulation.pcbdriverreceiverchannel
          name="BUS"
          driverRef={driverRef}
          receiverRef={receiverRef}
        />
        {additionalChannels}
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

/** Give P a longer physical path than the ideal bypass through both terminations. */
function DualTerminatedPositiveLeg(): JSX.Element {
  const footprints = [-3, -1, 1, 3]
  const names = footprints.map((_, index) => `RS${index + 1}`)
  const from = [".TX > .A", ...names.map((name) => `.${name} > .pin2`)]
  const to = [...names.map((name) => `.${name} > .pin1`), ".RX > .A"]
  return (
    <>
      <resistor
        name="RDRV"
        resistance="120"
        footprint="0402"
        pcbX={-7}
        connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
      />
      {names.map((name, index) => (
        <Fragment key={name}>
          <resistor
            name={name}
            resistance="33"
            footprint="0402"
            pcbX={footprints[index]}
            pcbY={0.3}
          />
        </Fragment>
      ))}
      {from.map((pin, index) => (
        <Fragment key={pin}>
          <trace
            from={pin}
            to={to[index]}
            width={0.15}
            pcbPath={[pin, to[index]]}
          />
        </Fragment>
      ))}
    </>
  )
}

/** Keep the junction between two series passives ideal while routing both ends. */
function PartialSeriesLeg({
  pin,
  y,
}: {
  pin: "A" | "B"
  y: number
}): JSX.Element {
  const driver = `.TX > .${pin}`
  const receiver = `.RX > .${pin}`
  const left = `R${pin}1`
  const right = `R${pin}2`
  return (
    <>
      <resistor
        name={left}
        resistance="33"
        footprint="0402"
        pcbX={-2}
        pcbY={y}
      />
      <resistor
        name={right}
        resistance="33"
        footprint="0402"
        pcbX={2}
        pcbY={y}
      />
      <trace
        from={driver}
        to={`.${left} > .pin1`}
        pcbPath={[driver, `.${left} > .pin1`]}
      />
      <trace from={`.${left} > .pin2`} to={`.${right} > .pin1`} />
      <trace
        from={`.${right} > .pin2`}
        to={receiver}
        pcbPath={[`.${right} > .pin2`, receiver]}
      />
    </>
  )
}
