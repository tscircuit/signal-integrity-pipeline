import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("polygonal plated pads use their board position when testing proximity", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <chip
        name="DISTANT"
        pcbY={5}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={-3}
              pcbY={0}
              shape="hole_with_polygon_pad"
              holeShape="circle"
              holeDiameter={0.25}
              holeOffsetX={0}
              holeOffsetY={0}
              padOutline={[
                { x: -0.3, y: -0.3 },
                { x: 0.3, y: -0.3 },
                { x: 0.3, y: 0.3 },
                { x: -0.3, y: 0.3 },
              ]}
            />
          </footprint>
        }
      />
    </board>,
  )
  const component = circuit.find(
    (record) => record.type === "source_component" && record.name === "DISTANT",
  )
  assert(component?.type === "source_component")
  const port = circuit.find(
    (record) =>
      record.type === "source_port" &&
      record.source_component_id === component.source_component_id,
  )
  assert(port?.type === "source_port")
  assert(!scopeFor({ circuit }).retainedSourceIds.includes(port.source_port_id))
})
