import type { JSX } from "react"
import { SignalPin, type TopologyBoard, topologyBoard } from "./topology-board"

/** A 0.45 mm stand-alone via on the named net. */
export function SignalVia({
  name,
  x,
  net = "SIGNAL",
}: {
  name: string
  x: number
  net?: string
}): JSX.Element {
  return (
    <via
      name={name}
      pcbX={x}
      pcbY={0}
      layers={["top", "bottom"]}
      holeDiameter={0.2}
      outerDiameter={0.45}
      connectsTo={`net.${net}`}
    />
  )
}

/** The driver pad can reach the barrel by outline contact alone. */
export function viaInDriverPad(offset: number): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} width={1} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="SIGNAL" />
        <SignalVia name="V" x={-4 + offset} />
        <trace from=".TX > .SIG" to="net.SIGNAL" />
        <trace
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -8 + offset, y: 0 }]}
        />
      </>
    ),
  })
}

/** A launch touches the pad's left edge, clear of the off-center barrel. */
export function viaInIntermediatePad(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="MID" x={0} width={1} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="SIGNAL" />
        <SignalVia name="V" x={0.25} />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 3.5, y: 0 }]}
        />
        <trace from=".MID > .SIG" to="net.SIGNAL" />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.75, y: 0 }]}
        />
      </>
    ),
  })
}

/** The stubs each touch only their nearest barrel. */
export function pairedVias(separation: number): Promise<TopologyBoard> {
  const offset = separation / 2
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="SIGNAL" />
        <SignalVia name="LEFT" x={-offset} />
        <SignalVia name="RIGHT" x={offset} />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 3.8 - offset, y: 0 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.8 + offset, y: 0 }]}
        />
      </>
    ),
  })
}
