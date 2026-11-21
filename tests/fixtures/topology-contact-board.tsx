import type { JSX } from "react"
import type { SourceNetId } from "../../src/board"
import {
  SignalModel,
  SignalPin,
  type TopologyBoard,
  topologyBoard,
} from "./topology-board"

/** A routed launch and a separately routed end that can approach on either side of copper contact. */
export async function offsetTraceEnds({
  separation,
}: {
  separation: number
}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4, y: 0 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.98, y: separation }]}
        />
      </>
    ),
  })
}

/** A trace whose embedded via switches from the incoming layer to the destination layer. */
export async function inlineVia({
  fromLayer = "top",
  toLayer = "bottom",
}: {
  fromLayer?: "top" | "bottom"
  toLayer?: "top" | "bottom"
} = {}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer={toLayer} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[
            ".TX > .SIG",
            { x: 4, y: 0, via: true, fromLayer, toLayer },
            ".RX > .SIG",
          ]}
        />
      </>
    ),
  })
}

/** Two wires leave the driver even though both downstream ends are linear. */
export async function driverBranch(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={0} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="STUB" x={-4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".TX > .SIG"
          to=".STUB > .SIG"
          pcbPath={[".TX > .SIG", ".STUB > .SIG"]}
        />
      </>
    ),
  })
}

/** Copper on a reference rail and an unrelated net crosses the selected signal. */
export async function railAndOtherCopper(): Promise<
  TopologyBoard & { rails: ReadonlySet<SourceNetId> }
> {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="UNRELATED" x={0} y={-4} />
        <SignalPin name="RAIL" x={0} y={4} />
        <net name="VCC" />
        <net name="OTHER" />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".TX > .SIG"
          to="net.VCC"
          pcbPath={[".TX > .SIG", { x: 4, y: 4 }, ".RAIL > .SIG"]}
        />
        <trace
          from=".UNRELATED > .SIG"
          to="net.OTHER"
          pcbPath={[".UNRELATED > .SIG", { x: 0, y: 8 }]}
        />
        <SignalPin name="UNRELATED_PAD" x={0} y={0.18} />
        <trace from=".RAIL > .SIG" to="net.VCC" />
      </>
    ),
  })
  const rail = board.circuit.find(
    (record) => record.type === "source_net" && record.name === "VCC",
  )
  if (!rail || rail.type !== "source_net")
    throw new Error("Expected core to emit VCC")
  return { ...board, rails: new Set([rail.source_net_id]) }
}

/** A straight trace ends inside the rotated copper outline of a plated receiver terminal. */
export async function rotatedPlatedHole({
  layer = "top",
}: {
  layer?: "top" | "bottom"
} = {}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} layer={layer} />
        <chip
          name="RX"
          pcbX={4}
          pcbY={0}
          pcbRotation={90}
          pinLabels={{ pin1: "SIG" }}
          footprint={
            <footprint>
              <platedhole
                portHints={["pin1"]}
                shape="hole_with_polygon_pad"
                pcbX={0}
                pcbY={0}
                holeDiameter={0.2}
                holeShape="circle"
                holeOffsetX={0}
                holeOffsetY={0}
                padOutline={[
                  { x: -1, y: -0.2 },
                  { x: 1, y: -0.2 },
                  { x: 1, y: 0.2 },
                  { x: -1, y: 0.2 },
                ]}
              />
            </footprint>
          }
        />
        <SignalModel name="RX" />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 2, y: 0.65 }, { x: 8, y: 0.65 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}

/** Two receiver pads land in the middle of one wire, in reverse declaration order. */
export async function midSegmentPads(): Promise<TopologyBoard> {
  return topologyBoard({
    receiverRef: [".RX > .SIG", ".EARLY > .SIG"],
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={2} y={0.23} />
        <SignalPin name="EARLY" x={-1} y={-0.23} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 8, y: 0 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
        <trace from=".EARLY > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}

/** An unselected plated pad occupies the gap between the top and bottom signal stubs. */
export async function unrelatedPlatedHole({
  rail = false,
}: {
  rail?: boolean
} = {}): Promise<TopologyBoard & { rails: ReadonlySet<SourceNetId> }> {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <net name="SIGNAL" />
        <chip
          name="UNRELATED"
          pinLabels={{ pin1: "SIG" }}
          footprint={
            <footprint>
              <platedhole
                portHints={["pin1"]}
                shape="circle"
                holeDiameter={0.2}
                outerDiameter={0.45}
              />
            </footprint>
          }
        />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 3.9, y: 0 }]}
        />
        <trace
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.9, y: 0 }]}
        />
        {rail && (
          <>
            <SignalModel name="UNRELATED" />
            <trace from=".UNRELATED > .SIG" to="net.SIGNAL" />
          </>
        )}
      </>
    ),
  })
  if (!rail) return { ...board, rails: new Set() }
  const hole = board.circuit.find((record) => record.type === "pcb_plated_hole")
  const port = board.circuit.find(
    (record) =>
      record.type === "pcb_port" &&
      hole?.type === "pcb_plated_hole" &&
      record.pcb_port_id === hole.pcb_port_id,
  )
  if (!port || port.type !== "pcb_port")
    throw new Error("Expected the plated terminal")
  return { ...board, rails: new Set([port.source_port_id]) }
}

/** Two ideal passives share the driver terminal on a board with no routed signal traces. */
export async function unroutedPassiveBranch(): Promise<TopologyBoard> {
  const footprint = (
    <footprint>
      <smtpad
        portHints={["pin1"]}
        pcbX={0}
        pcbY={0}
        width={0.4}
        height={0.4}
        shape="rect"
      />
      <smtpad
        portHints={["pin2"]}
        pcbX={1}
        pcbY={0}
        width={0.4}
        height={0.4}
        shape="rect"
      />
    </footprint>
  )
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={0} />
        <SignalPin name="RX" x={4} />
        <resistor
          name="ONE"
          pcbX={0}
          pcbY={0}
          resistance="33"
          pcbRotation={90}
          footprint={footprint}
        />
        <resistor
          name="TWO"
          pcbX={0}
          pcbY={0}
          resistance="33"
          pcbRotation={-90}
          footprint={footprint}
        />
        <trace from=".TX > .SIG" to=".ONE > .pin1" />
        <trace from=".TX > .SIG" to=".TWO > .pin1" />
        <trace from=".ONE > .pin2" to=".RX > .SIG" />
      </>
    ),
  })
}

/** A schematic passive has only its first PCB terminal populated. */
export async function partialPassiveFootprint(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <resistor
          name="PARTIAL"
          resistance="33"
          pcbY={4}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.4}
                height={0.4}
                shape="rect"
              />
            </footprint>
          }
        />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace from=".TX > .SIG" to=".PARTIAL > .pin1" />
      </>
    ),
  })
}

/** A passive lies in series with one leg, with no connection to the other leg. */
export async function differentialSeriesPassive(): Promise<TopologyBoard> {
  return topologyBoard({
    driverRef: { p: ".TXP > .SIG", n: ".TXN > .SIG" },
    receiverRef: { p: ".RXP > .SIG", n: ".RXN > .SIG" },
    children: (
      <>
        <SignalPin name="TXP" x={-4} y={-2} />
        <SignalPin name="RXP" x={4} y={-2} />
        <SignalPin name="TXN" x={-4} y={2} />
        <SignalPin name="RXN" x={4} y={2} />
        <resistor name="SERIES" resistance="33" footprint="0402" pcbY={-2} />
        <trace
          from=".TXP > .SIG"
          to=".SERIES > .pin1"
          pcbPath={[".TXP > .SIG", ".SERIES > .pin1"]}
        />
        <trace
          from=".SERIES > .pin2"
          to=".RXP > .SIG"
          pcbPath={[".SERIES > .pin2", ".RXP > .SIG"]}
        />
        <trace
          from=".TXN > .SIG"
          to=".RXN > .SIG"
          pcbPath={[".TXN > .SIG", ".RXN > .SIG"]}
        />
      </>
    ),
  })
}

/** One source terminal has an SMT pad on each layer, with no shared barrel. */
function LayeredSignalPin({
  name,
  x,
}: {
  name: string
  x: number
}): JSX.Element {
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pcbY={0}
        pinLabels={{ pin1: "SIG" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={0.4}
              height={0.4}
              shape="rect"
              layer="top"
            />
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={0.4}
              height={0.4}
              shape="rect"
              layer="bottom"
            />
          </footprint>
        }
      />
      <SignalModel name={name} />
    </>
  )
}

/** The top copper remains branched even though the driver's bottom pad is isolated. */
export async function layeredDriverBranch(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <LayeredSignalPin name="TX" x={0} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="STUB" x={-4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".TX > .SIG"
          to=".STUB > .SIG"
          pcbPath={[".TX > .SIG", ".STUB > .SIG"]}
        />
      </>
    ),
  })
}

/** The receiver can sample via its bottom pad while its top pad is isolated. */
export async function layeredReceiver(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} layer="bottom" />
        <LayeredSignalPin name="RX" x={4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
      </>
    ),
  })
}

/** A separate routed net crosses the signal stubs at its barrel. */
export async function viaOnUnrelatedPcbTrace(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <SignalPin name="OTHER_TOP" x={0} y={-4} />
        <SignalPin name="OTHER_BOTTOM" x={0} y={4} layer="bottom" />
        <net name="SIGNAL" />
        <trace
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 3.9, y: 0 }]}
        />
        <trace
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.9, y: 0 }]}
        />
        <trace
          from=".OTHER_TOP > .SIG"
          to=".OTHER_BOTTOM > .SIG"
          pcbPath={[
            ".OTHER_TOP > .SIG",
            { x: 0, y: 4, via: true, toLayer: "bottom" },
            ".OTHER_BOTTOM > .SIG",
          ]}
        />
      </>
    ),
  })
}
