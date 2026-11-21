import { buildRoutedCopper } from "../../src/pipeline/topology-copper"
import { SignalPin, topologyBoard } from "./topology-board"

/** A wire's rounded cap touches the receiver beyond the centerline endpoint. */
export async function wireCapBoard(
  receiverX: number,
): Promise<ReturnType<typeof buildRoutedCopper>> {
  const { circuit } = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} width={0.01} />
        <SignalPin name="RX" x={receiverX} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4, y: 0 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
  const ports = circuit.filter((record) => record.type === "pcb_port")
  return buildRoutedCopper({
    circuit,
    ports,
    traces: circuit.filter((record) => record.type === "pcb_trace"),
    selected: new Set(ports.map((port) => port.source_port_id)),
    rails: new Set(),
    traceIds: new Set(),
  })
}
