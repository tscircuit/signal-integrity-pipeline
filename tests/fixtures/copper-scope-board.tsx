import assert from "node:assert/strict"
import type { TraceProps } from "@tscircuit/props"
import type { LayerRef, PcbTrace } from "circuit-json"
import type React from "react"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  type SourceNetId,
  sourceNetMembers,
} from "../../src/board"
import { renderCoreSignals } from "../support/core-render"

/** Size in millimetres of each square test pad. */
const PAD_SIZE_MM = 0.3

/** Distance from the route midpoint to each access barrel in millimetres. */
const ACCESS_BARREL_X_MM = 7

interface WireProps {
  name: string
  y: number
  x?: number
  width?: number
  layer?: LayerRef
  startPad?: React.JSX.Element
  extent?: number
}

/** Route at board y, with chip-relative access barrels beyond the selected endpoints. */
export function Wire({
  name,
  y,
  x = 0,
  width = 0.1,
  layer = "top",
  extent = 8,
  startPad,
}: WireProps): React.JSX.Element {
  const from = `.${name} > .A`
  const to = `.${name} > .B`
  const left = { x: -ACCESS_BARREL_X_MM, y: 0 }
  const right = { x: ACCESS_BARREL_X_MM, y: 0 }
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [from]
  if (layer !== "top" && layer !== "bottom") {
    pcbPath.push(left, {
      ...left,
      via: true,
      fromLayer: "top",
      toLayer: layer,
    })
    pcbPath.push(right, {
      ...right,
      via: true,
      fromLayer: layer,
      toLayer: "top",
    })
  }
  pcbPath.push(to)
  let padLayer: LayerRef = "top"
  if (layer === "bottom") padLayer = layer
  return (
    <>
      <chip
        name={name}
        pcbX={x}
        pcbY={y}
        layer={padLayer}
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            {startPad ?? (
              <smtpad
                portHints={["pin1"]}
                pcbX={-extent}
                pcbY={0}
                width={PAD_SIZE_MM}
                height={PAD_SIZE_MM}
                shape="rect"
              />
            )}
            <smtpad
              portHints={["pin2"]}
              pcbX={extent}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace
        name={`${name}_route`}
        from={from}
        to={to}
        width={width}
        pcbPath={pcbPath}
      />
    </>
  )
}

/** Selected and neighboring traces, pads and pours for the proximity tests. */
export function ScopeNeighborsBoard(): React.JSX.Element {
  return (
    <board
      width={24}
      height={16}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      <chip
        name="PAD_ONLY"
        pcbY={-0.8}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              width={PAD_SIZE_MM}
              height={PAD_SIZE_MM}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace from=".PAD_ONLY > .A" to="net.FLOATING" />
      <Wire name="SELECTED" y={0} extent={5} />
      <Wire name="SAME" y={1.05} />
      <Wire name="FAR" y={2} extent={10} />
      <Wire name="ADJACENT" y={-0.5} layer="inner1" extent={9} />
      <Wire name="DEEP" y={-1} layer="inner2" extent={11} />
      <copperpour name="RETURN" layer="bottom" connectsTo="net.GND" unbroken />
      <copperpour
        name="OTHER_PLANE"
        layer="inner1"
        connectsTo="net.OTHER"
        unbroken
        outline={[
          { x: -1, y: 0.8 },
          { x: 1, y: 0.8 },
          { x: 1, y: 1.4 },
          { x: -1, y: 1.4 },
        ]}
      />
    </board>
  )
}

/** Render the same via approach with or without a redundant top-layer route point. */
export async function viaApproach({
  explicitWire,
  selectedLayer = "bottom",
  exitToLeft = false,
  neighborY = 0.6,
  width = 0.1,
}: {
  explicitWire: boolean
  selectedLayer?: LayerRef
  exitToLeft?: boolean
  neighborY?: number
  width?: number
}): Promise<CircuitJson> {
  const from = ".FAN > .A"
  const to = ".FAN > .B"
  const entry = { x: 7, y: 0 }
  let startX = -8
  if (exitToLeft) startX = 8
  const via = {
    ...entry,
    via: true,
    fromLayer: "top",
    toLayer: "bottom",
  } as const
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [from]
  if (explicitWire) pcbPath.push(entry)
  pcbPath.push(via, to)
  return renderCoreSignals(
    <board
      width={22}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer={selectedLayer} />
      <chip
        name="FAN"
        pcbY={neighborY}
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={startX}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={-startX}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
              layer="bottom"
            />
          </footprint>
        }
      />
      <trace
        name="FAN_route"
        from={from}
        to={to}
        width={width}
        pcbPath={pcbPath}
      />
    </board>,
  )
}

/** Scope and retained trace names for the neighboring-copper board. */
interface ScopeNeighbors {
  circuit: CircuitJson
  scope: CopperScope
  retained: string[]
}

/** Render copper with an intentionally unrouted logical connection. */
export async function renderScopeBoard(
  board: React.ReactElement,
): Promise<CircuitJson> {
  return renderCoreSignals(board).catch((error: unknown) => {
    assert(error instanceof Error && "circuitJson" in error)
    const circuit = error.circuitJson as CircuitJson
    const errors = circuit.filter((record) => record.type.endsWith("_error"))
    assert(errors.length > 0)
    for (const record of errors)
      assert.equal(record.type, "pcb_port_not_connected_error")
    return circuit
  })
}

/** Render and select the channel on the neighboring-copper board. */
export async function scopeNeighbors(): Promise<ScopeNeighbors> {
  const circuit = await renderScopeBoard(<ScopeNeighborsBoard />)
  const sourceTraces = circuit.filter(
    (record) => record.type === "source_trace",
  )
  const selected = sourceTraces.find(
    (trace) => trace.name === "SELECTED_route",
  )!
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const scope = channelCopperScope({
    circuit,
    connectivity,
    selected: sourceNetMembers({
      connectivity,
      seed: selected.connected_source_port_ids[0],
    }),
    reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
    rails: new Set(),
    distanceMm: 1,
  })
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const retained = traces
    .filter((trace) => scope.pcbTraceIds.includes(trace.pcb_trace_id))
    .map((trace) => {
      const source = sourceTraces.find(
        (source) => source.source_trace_id === trace.source_trace_id,
      )!
      return source.name!.replace("_route", "")
    })
  return { circuit, scope, retained }
}

/** Find a named source net on the rendered board. */
export function scopeNet({
  circuit,
  name,
}: {
  circuit: CircuitJson
  name: string
}): SourceNetId {
  const net = circuit.find(
    (record) => record.type === "source_net" && record.name === name,
  )
  assert(net?.type === "source_net", name)
  return net.source_net_id
}

/** Find a PCB trace whose named source trace was supplied by Wire. */
export function scopeTrace({
  circuit,
  name,
}: {
  circuit: CircuitJson
  name: string
}): PcbTrace {
  const source = circuit.find(
    (record) =>
      record.type === "source_trace" && record.name === `${name}_route`,
  )
  assert(source?.type === "source_trace", name)
  const trace = circuit.find(
    (record) =>
      record.type === "pcb_trace" &&
      record.source_trace_id === source.source_trace_id,
  )
  assert(trace?.type === "pcb_trace", name)
  return trace
}

/** Scope the default SELECTED wire or a named logical net on the rendered board. */
export function scopeFor({
  circuit,
  distanceMm = 1,
  selectedNet,
  referenceNet,
  railNets = [],
}: {
  circuit: CircuitJson
  distanceMm?: number
  selectedNet?: string
  referenceNet?: string
  railNets?: string[]
}): CopperScope {
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  let seed: SourceNetId
  if (selectedNet !== undefined) {
    seed = scopeNet({ circuit, name: selectedNet })
  } else {
    const source = circuit.find(
      (record) =>
        record.type === "source_trace" && record.name === "SELECTED_route",
    )
    assert(source?.type === "source_trace")
    seed = source.connected_source_port_ids[0]
  }
  const selected = sourceNetMembers({ connectivity, seed })
  let reference = new Set<SourceNetId>()
  if (referenceNet !== undefined) {
    reference = sourceNetMembers({
      connectivity,
      seed: scopeNet({ circuit, name: referenceNet }),
    })
  }
  const rails = new Set<SourceNetId>()
  for (const name of railNets) {
    const members = sourceNetMembers({
      connectivity,
      seed: scopeNet({ circuit, name }),
    })
    for (const id of members) rails.add(id)
  }
  return channelCopperScope({
    circuit,
    connectivity,
    selected,
    reference,
    rails,
    distanceMm,
  })
}
