import { test } from "bun:test"
import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { channelCopperScope } from "../../../../src/board"
import {
  scopeNet,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a routed source trace can be selected by an explicit source net ID", async () => {
  const circuit = await renderCoreSignals(
    <board width={20} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="CHANNEL" y={0} extent={3} />
      <Wire name="FAR" y={5} extent={3} />
      <trace from=".FAR > .A" to="net.SIGNAL" />
      <trace name="NET_LINK" from=".CHANNEL > .A" to="net.SIGNAL" />
    </board>,
  )
  const trace = scopeTrace({ circuit, name: "CHANNEL" })
  const net = scopeNet({ circuit, name: "SIGNAL" })
  const source = circuit.find(
    (record) => record.type === "source_trace" && record.name === "NET_LINK",
  )
  assert(source?.type === "source_trace")
  assert(source.connected_source_net_ids?.includes(net))
  // A route can reference the trace that declares its net instead of the point-to-point trace.
  const records = circuit.map((record) => {
    if (record !== trace) return record
    return { ...trace, source_trace_id: source.source_trace_id }
  })
  const result = channelCopperScope({
    circuit: records,
    connectivity: new ConnectivityMap({}),
    selected: new Set([net]),
    reference: new Set(),
    rails: new Set(),
    distanceMm: 0.5,
  })
  assert.deepEqual(result.selectedPcbTraceIds, [trace.pcb_trace_id])
  assert.deepEqual(result.pcbTraceIds, [trace.pcb_trace_id])
  assert.equal(result.lateralDistanceMm, 0.5)
  const channel = circuit.find(
    (record) =>
      record.type === "source_trace" &&
      record.source_trace_id === trace.source_trace_id,
  )
  assert(channel?.type === "source_trace")
  assert.deepEqual(
    new Set(result.retainedSourceIds),
    new Set([net, ...channel.connected_source_port_ids]),
  )
})
