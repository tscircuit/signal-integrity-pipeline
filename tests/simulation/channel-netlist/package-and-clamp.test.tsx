import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import {
  fixturePortId,
  planNetlistChannels,
} from "../../fixtures/channel-netlist"
import { separateClampIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

// IBIS uses rail minus pad voltage. The clamp only conducts into the rail.
const physicalSeparateClampIbis = separateClampIbis
  .replaceAll("1.8 1.8 1.8", "3.6 3.6 3.6")
  .replaceAll(
    "-10 -0.1 -0.1 -0.1\n10 0.1 0.1 0.1",
    "-10 0.1 0.1 0.1\n-0.5 0 0 0\n10 0 0 0",
  )

test("binds package parasitics and a separate power clamp bias", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" separateClampRail />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const ibisText = physicalSeparateClampIbis
    .replace("R_pkg 0 0 0", "R_pkg 0.2 0.2 0.2")
    .replace("L_pkg 0 0 0", "L_pkg 2n 2n 2n")
    .replace("C_pkg 0 0 0", "C_pkg 0.4p 0.4p 0.4p")
  const [{ bindings }] = planNetlistChannels({ circuitJson, ibisText })
  const solver = new ChannelNetlistSolver(bindings)
  solver.solve()

  const { electricalLines, models, nodeMap } = solver.getOutput().value
  const db = cju(circuitJson)
  const clamp = db.source_net.getWhere({ name: "PC" })
  const power = db.source_net.getWhere({ name: "VCC" })
  assert.ok(clamp && power)
  const clampNode = nodeMap[clamp.source_net_id]
  const powerNode = nodeMap[power.source_net_id]
  assert.ok(clampNode && powerNode)
  assert.equal(new Set(["0", clampNode, powerNode]).size, 3)
  for (const bias of [` ${clampNode} 0 3.6`, ` ${powerNode} 0 3.3`])
    assert.equal(
      electricalLines.filter((line) => line.endsWith(bias)).length,
      1,
    )
  const [seriesInput, seriesOutput] = [1, 2].map(
    (pin) => nodeMap[fixturePortId({ db, component: "RS", pin })],
  )
  assert.ok(seriesInput && seriesOutput)
  assert.notEqual(seriesInput, seriesOutput)
  assert.deepEqual(
    electricalLines.filter((line) => line.startsWith("R")),
    [`RPHYSICAL0 ${seriesInput} ${seriesOutput} 33`],
  )
  const expected = [
    { component: "TX", pin: 4, refs: ["ground", "power", "clamp"] },
    { component: "RX", pin: 2, refs: ["power", "clamp", "ground"] },
  ] as const
  assert.equal(models.length, expected.length)
  for (const [index, { component, pin, refs }] of expected.entries()) {
    const [pad, ground, power, clamp] = [pin, 3, 5, 6].map((pin) =>
      fixturePortId({ db, component, pin }),
    )
    const ports = { ground, power, clamp }
    const { source, spicePinMapping } = models[index]
    assert.deepEqual(spicePinMapping, {
      PAD0: pad,
      REF0: ports[refs[0]],
      REF1: ports[refs[1]],
      REF2: ports[refs[2]],
    })
    assert.equal(nodeMap[ground], "0")
    assert.equal(nodeMap[power], powerNode)
    assert.equal(nodeMap[clamp], clampNode)
    const lines = source.split("\n")
    assert.ok(lines.includes("RPKG0 PAD0 PKGR0 0.2"))
    assert.ok(lines.includes("LPKG0 PKGR0 PKGL0 2e-9"))
    assert.match(source, /^CPKG0a PAD0 DIE[0-9]+ 2e-13$/m)
    assert.match(source, /^CPKG0b PKGL0 DIE[0-9]+ 2e-13$/m)
  }
})
