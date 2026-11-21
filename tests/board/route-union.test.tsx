import { test } from "bun:test"
import assert from "node:assert/strict"
import type React from "react"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  segmentRoutes,
  sourceNetMembers,
} from "../../src/board"
import { renderCoreSignals } from "../support/core-render"

/** Each test strip is 0.3 mm wide and the two centre lines are 0.3 mm apart. */
const STRIP_WIDTH_MM = 0.3

/** The same-net union covers both strips, within the existing floating-point tolerance. */
const UNION_WIDTH_MM = 0.6
const WIDTH_TOLERANCE_MM = 1e-7

/** Two same-net strips meet exactly at their edges, as on the board's DDR power rail. */
function TouchingRail({
  "same-net": sameNet = true,
}: {
  "same-net"?: boolean
}): React.JSX.Element {
  return (
    <board
      width={8}
      height={5}
      layers={2}
      thickness={0.4}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {[
        { name: "A", x: -2, y: 0 },
        { name: "B", x: 2, y: 0 },
        { name: "C", x: -2, y: STRIP_WIDTH_MM },
        { name: "D", x: 2, y: STRIP_WIDTH_MM },
      ].map(({ name, x, y }) => {
        let net = "net.RAIL"
        if (y !== 0 && !sameNet) net = "net.OTHER"
        return (
          <chip
            key={name}
            name={name}
            pcbX={x}
            pcbY={y}
            pinLabels={{ pin1: "P" }}
            connections={{ P: net }}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={0}
                  pcbY={0}
                  width={0.15}
                  height={0.15}
                  shape="rect"
                />
              </footprint>
            }
          />
        )
      })}
      <trace
        from=".A > .P"
        to=".B > .P"
        width={STRIP_WIDTH_MM}
        pcbPath={[".A > .P", ".B > .P"]}
      />
      <trace
        from=".C > .P"
        to=".D > .P"
        width={STRIP_WIDTH_MM}
        pcbPath={[".C > .P", ".D > .P"]}
      />
      <net name="RAIL" />
      <net name="OTHER" />
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="bottom" unbroken />
    </board>
  )
}

/** Select both same-net strips for comparison, including their reference plane. */
function touchingRailScope(circuit: CircuitJson): CopperScope {
  const rail = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "RAIL")!
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  return channelCopperScope({
    circuit,
    connectivity,
    selected: sourceNetMembers({ connectivity, seed: rail.source_net_id }),
    reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
    rails: new Set(),
    distanceMm: 1,
  })
}

test("touching same-net strips form one conductor", async () => {
  const circuit = await renderCoreSignals(<TouchingRail />)
  const geometry = segmentRoutes({ circuit, scope: touchingRailScope(circuit) })
  assert.ok(
    geometry.wires.some((wire) => {
      return (
        Math.abs(wire.width - UNION_WIDTH_MM) < WIDTH_TOLERANCE_MM &&
        wire.joins?.length
      )
    }),
  )
})

test("touching strips on separate nets stay separate", async () => {
  const circuit = await renderCoreSignals(<TouchingRail />)
  const scope = touchingRailScope(circuit)
  const board = <TouchingRail same-net={false} />
  const separate = await renderCoreSignals(board).catch(
    (error: Error & { circuitJson: CircuitJson }) => {
      const errors = error.circuitJson.filter((record) =>
        record.type.endsWith("_error"),
      )
      assert.ok(errors.some((record) => record.type === "pcb_trace_error"))
      assert.ok(
        errors.every((record) => {
          return (
            record.type === "pcb_trace_error" ||
            record.type === "pcb_pad_trace_clearance_error"
          )
        }),
      )
      return error.circuitJson
    },
  )

  assert.ok(
    segmentRoutes({ circuit: separate, scope }).wires.every(
      (wire) => !wire.joins?.length,
    ),
  )
})
