import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { planNetlistChannels } from "../../fixtures/channel-netlist"
import { separateClampIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("binds package parasitics and a separate power clamp bias", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" separateClampRail />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const ibisText = separateClampIbis
    .replace("R_pkg 0 0 0", "R_pkg 0.2 0.2 0.2")
    .replace("L_pkg 0 0 0", "L_pkg 2n 2n 2n")
    .replace("C_pkg 0 0 0", "C_pkg 0.4p 0.4p 0.4p")
  const [{ bindings }] = planNetlistChannels({ circuitJson, ibisText })
  const solver = new ChannelNetlistSolver(bindings)
  solver.solve()

  const { electricalLines, models, nodeMap, receiverPaths } =
    solver.getOutput().value
  const db = cju(circuitJson)
  const clamp = db.source_net.getWhere({ name: "PC" })
  const power = db.source_net.getWhere({ name: "VCC" })
  assert.ok(clamp && power)
  const clampNode = nodeMap[clamp.source_net_id]
  const powerNode = nodeMap[power.source_net_id]
  assert.ok(clampNode && powerNode)
  assert.notEqual(clampNode, powerNode)
  for (const bias of [` ${clampNode} 0 1.8`, ` ${powerNode} 0 3.3`])
    assert.equal(
      electricalLines.filter((line) => line.endsWith(bias)).length,
      1,
    )
  const [{ fromSourcePortId, toSourcePortId }] = receiverPaths
  assert.deepEqual(
    models.map(({ spicePinMapping }) => spicePinMapping.PAD0),
    [fromSourcePortId, toSourcePortId],
  )
  for (const { source, spicePinMapping } of models) {
    assert.deepEqual(
      Object.entries(spicePinMapping)
        .filter(([pin]) => pin.startsWith("REF"))
        .map(([, port]) => nodeMap[port])
        .sort(),
      ["0", clampNode, powerNode].sort(),
    )
    const lines = source.split("\n")
    assert.ok(lines.includes("RPKG0 PAD0 PKGR0 0.2"))
    assert.ok(lines.includes("LPKG0 PKGR0 PKGL0 2e-9"))
    assert.match(source, /^CPKG0a PAD0 DIE[0-9]+ 2e-13$/m)
    assert.match(source, /^CPKG0b PKGL0 DIE[0-9]+ 2e-13$/m)
  }
})
