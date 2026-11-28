import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  getCopperGeometryExtractionInput,
} from "../../fixtures/copper-geometry-board"
import { renderCoreBoard } from "../../support/core-render"

test("rejects a required pad within the bore of a route-only via", async () => {
  const circuit = await renderCoreBoard({
    keepDrcErrors: true,
    tree: (
      <board
        width={14}
        height={10}
        layers={4}
        thickness={1.6}
        fabricatorPreset="jlcpcb_standard"
        allowBlindAndBuriedVias
        routeRemaining={false}
        schematicDisabled
        autorouter={{ local: true }}
        pcbRouteCache={{
          cacheKey: "route-only-via",
          pcbTraces: [
            {
              type: "pcb_trace",
              pcb_trace_id: "cached_trace_0",
              source_trace_id: "source_trace_0",
              route: [
                { route_type: "wire", x: -4, y: 0, width: 0.2, layer: "top" },
                { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
                {
                  route_type: "via",
                  x: 0,
                  y: 0,
                  from_layer: "top",
                  to_layer: "bottom",
                  hole_diameter: 0.7,
                },
              ],
            },
          ],
        }}
      >
        <net name="GND" />
        <net name="SIGNAL" />
        <CopperPad name="SignalStart" x={-4} />
        <CopperPad name="Bore" x={0} layer="bottom" />
        <trace from=".SignalStart > .P" to=".Bore > .P" />
        <copperpour connectsTo="net.GND" layer="inner1" unbroken />
      </board>
    ),
  })
  const db = cju(circuit)
  assert.equal(db.pcb_via.list().length, 0)
  const [trace] = db.pcb_trace.list()
  const via = trace.route.find((point) => point.route_type === "via")
  assert.equal(via?.hole_diameter, 0.7)
  assert.equal(via?.outer_diameter, undefined)

  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Bore"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
})
