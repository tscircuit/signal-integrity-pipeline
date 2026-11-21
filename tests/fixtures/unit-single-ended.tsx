// Topology/transient unit-test source only.
import { simulation } from "@tscircuit/core"
import type React from "react"
import { Inverter, Reference } from "./signal-parts"

/** Single-ended test rate in bits per second. */
const BIT_RATE_BPS = 20e6

/** Capture this many bits from the single-ended channel. */
const CAPTURE_BITS = 48

/** Build a single-ended channel from the driver to the receiver. */
export default function ({
  bitRate = BIT_RATE_BPS,
  pattern,
  seed,
  timing = { durationSeconds: CAPTURE_BITS / bitRate },
}: {
  bitRate?: number
  pattern?: string
  seed?: number
  timing?: {
    durationSeconds?: number
    offsetSeconds?: number
  }
} = {}): React.JSX.Element {
  return (
    <board
      width={16}
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
      <trace
        from=".TX > .Y"
        to=".RX > .A"
        width={0.2}
        pcbPath={[".TX > .Y", ".RX > .A"]}
      />
      <simulation.pcbtransientchannelsimulation
        name="SINGLE"
        bitRate={bitRate}
        duration={timing.durationSeconds}
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef=".TX > .Y"
          receiverRef=".RX > .A"
          pattern={pattern}
          seed={seed}
          offset={timing.offsetSeconds}
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}
