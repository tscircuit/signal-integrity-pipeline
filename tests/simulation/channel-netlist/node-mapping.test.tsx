import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"

test("binds each buffer pin and reference to its allocated SPICE node", async () => {
  const input = await renderTwoTraceNetlistInput()
  const solver = new ChannelNetlistSolver(input)
  solver.solve()
  const { value, artifacts } = solver.getOutput()
  const { models, nodeMap, receiverPaths, groundSourcePortId } = value
  const expected = [
    { portNumbers: [2, 1, 3], nodes: ["n2", "0", "n3"] },
    { portNumbers: [6, 7, 9], nodes: ["n6", "0", "n3"] },
    { portNumbers: [14, 13, 15], nodes: ["n11", "0", "n3"] },
    { portNumbers: [18, 19, 21], nodes: ["n14", "0", "n3"] },
  ]
  assert.equal(models.length, expected.length)
  for (const [index, { portNumbers, nodes }] of expected.entries()) {
    const [pad, ground, power] = portNumbers.map((id) => `source_port_${id}`)
    assert.deepEqual(models[index].spicePinMapping, {
      PAD0: pad,
      REF0: ground,
      REF1: power,
    })
    assert.deepEqual([nodeMap[pad], nodeMap[ground], nodeMap[power]], nodes)
  }
  assert.equal(receiverPaths.length, 2)
  for (const { fromSourcePortId, toSourcePortId } of receiverPaths)
    assert.notEqual(nodeMap[fromSourcePortId], nodeMap[toSourcePortId])
  assert.equal(nodeMap[groundSourcePortId], "0")
  const nodeMapArtifact = artifacts.find(
    ({ path }) => path === `${input.artifactPrefix}/electrical-node-map.json`,
  )
  assert.ok(nodeMapArtifact)
  assert.equal(nodeMapArtifact.owner, "simulation")
  assert.deepEqual(JSON.parse(nodeMapArtifact.body), {
    nodes: nodeMap,
    channelReferenceSourcePortId: groundSourcePortId,
  })
})
