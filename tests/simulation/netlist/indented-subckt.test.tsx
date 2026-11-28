import { test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit } from "@tscircuit/core"
import type { ReactElement } from "react"
import type { CircuitJson } from "../../../src/board"
import { type CircuitNodes, electricalSources } from "../../../src/simulation"

/** Render only source and simulation records through core. */
async function renderWithoutPcb(tree: ReactElement): Promise<CircuitJson> {
  const circuit = new Circuit({
    platform: { partsEngineDisabled: true, pcbDisabled: true },
  })
  circuit.add(tree)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}

/** Give SPICE's zero node to ground and stable test nodes to other ports. */
function testNode({ id, ground }: { id: string; ground: string }): string {
  if (id === ground) return "0"
  return `n_${id}`
}

/** Find one rendered source port by its component name and pin number. */
function sourcePortId({
  circuit,
  componentName,
  pinNumber,
}: {
  circuit: CircuitJson
  componentName: string
  pinNumber: number
}): string {
  const component = circuit.find(
    (record) =>
      record.type === "source_component" && record.name === componentName,
  )
  assert.ok(component?.type === "source_component")
  const port = circuit.find(
    (record) =>
      record.type === "source_port" &&
      record.source_component_id === component.source_component_id &&
      record.pin_number === pinNumber,
  )
  assert.ok(port?.type === "source_port")
  return port.source_port_id
}

test("leading whitespace before a placed subcircuit wrapper is ignored", async () => {
  const circuit = await renderWithoutPcb(
    <board routeRemaining={false} schematicDisabled>
      <chip name="SUPPLY" pinLabels={{ pin1: "VDD", pin2: "GND" }} />
      <chip name="R1" pinLabels={{ pin1: "A", pin2: "B" }}>
        <spicemodel
          source={
            "  .subckt SHUNT pin1 pin2\n" +
            "  R1 pin1 pin2 100\n" +
            "  .ends SHUNT\n"
          }
        />
      </chip>
    </board>,
  )
  const model = circuit.find(
    (record) => record.type === "simulation_spice_subcircuit",
  )
  assert.ok(model?.type === "simulation_spice_subcircuit")
  const supplyPositive = sourcePortId({
    circuit,
    componentName: "SUPPLY",
    pinNumber: 1,
  })
  const supplyNegative = sourcePortId({
    circuit,
    componentName: "SUPPLY",
    pinNumber: 2,
  })
  const resistorPositive = sourcePortId({
    circuit,
    componentName: "R1",
    pinNumber: 1,
  })
  const resistorNegative = sourcePortId({
    circuit,
    componentName: "R1",
    pinNumber: 2,
  })
  const nodes: CircuitNodes = {
    node: (id) => testNode({ id, ground: supplyNegative }),
    groundSourcePortId: supplyNegative,
    mapping: {},
  }
  const sources = electricalSources({
    circuit,
    modeling: {
      supplies: [
        {
          positive: { sourcePortId: supplyPositive },
          negative: { sourcePortId: supplyNegative },
          voltageV: 3.3,
        },
      ],
      passiveComponents: [{ sourceComponentId: model.source_component_id }],
    },
    nodes,
  })
  assert.ok(
    sources.lines.some((line) =>
      line.includes(
        `XPHYSICAL0 n_${resistorPositive} n_${resistorNegative} PLACED0_SHUNT`,
      ),
    ),
  )
})
