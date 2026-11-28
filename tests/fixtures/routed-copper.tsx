import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../src/board"
import { renderCoreSignals } from "../support/core-render"

/** A rendered fixture board and the copper scoped for field checks. */
interface RoutedCopper {
  circuitJson: CircuitJson
  copperScope: CopperScope
}

/** Real TSX geometry without vendor assets, for pure geometry and field checks. */
export async function renderRoutedCopper(): Promise<RoutedCopper> {
  const chips = [
    ["A", -4, 0],
    ["B", 4, 0],
    ["C", -4, 0.35],
    ["D", 4, 0.35],
  ] as const
  const circuitJson = await renderCoreSignals(
    <board
      width={12}
      height={8}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {chips.map(([name, x, y]) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pcbY={y}
          pinLabels={{ pin1: "P" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                width={0.2}
                height={0.2}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      <trace
        from=".A > .P"
        to=".B > .P"
        width={0.1}
        pcbPath={[".A > .P", ".B > .P"]}
      />
      <trace
        from=".C > .P"
        to=".D > .P"
        width={0.1}
        pcbPath={[".C > .P", ".D > .P"]}
      />
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="bottom" unbroken />
    </board>,
  )
  const db = cju(circuitJson)
  const [trace] = db.source_trace.list()
  if (!trace) throw new Error("Missing TSX trace")
  const ground = db.source_net.getWhere({ name: "GND" })
  if (!ground) throw new Error("Missing TSX ground")
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuitJson)
  const copperScope = channelCopperScope({
    circuit: circuitJson,
    connectivity,
    channelSourceIds: sourceNetMembers({
      connectivity,
      memberId: trace.connected_source_port_ids[0],
    }),
    referenceSourceIds: sourceNetMembers({
      connectivity,
      memberId: ground.source_net_id,
    }),
    distanceMm: 1,
    railSourceIds: new Set(),
  })
  return { circuitJson, copperScope }
}
