import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type { AssemblyEntry } from "../../../src/buffers"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { fixturePortId } from "../../fixtures/channel-netlist"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { plannedBindings, renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("allocates distinct SPICE nodes for each leg of a routed differential channel", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const bindings = plannedBindings({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  const solver = new ChannelNetlistSolver(bindings)
  solver.solve()

  const { value, artifacts } = solver.getOutput()
  const { models, nodeMap, plan, receiverPaths, groundSourcePortId } = value
  const db = cju(circuitJson)
  const power = db.source_net.getWhere({ name: "VCC" })
  assert.ok(power)
  const powerNode = nodeMap[power.source_net_id]
  assert.ok(powerNode)
  const nodes = new Set(["0", powerNode])
  const components = ["TX", "RX"]
  assert.equal(models.length, components.length)
  for (const [index, component] of components.entries()) {
    const [positive, negative, ground, supply] = [6, 7, 5, 8].map((pin) =>
      fixturePortId({ db, component, pin }),
    )
    assert.deepEqual(models[index].spicePinMapping, {
      PAD0: positive,
      PAD1: negative,
      REF0: ground,
      REF1: supply,
    })
    assert.equal(nodeMap[ground], "0")
    assert.equal(nodeMap[supply], powerNode)
    for (const id of [positive, negative]) {
      assert.ok(nodeMap[id])
      nodes.add(nodeMap[id])
    }
  }
  for (const pin of [1, 2]) {
    const node = nodeMap[fixturePortId({ db, component: "RTERM", pin })]
    assert.ok(node)
    nodes.add(node)
  }
  assert.equal(nodes.size, 8)
  const [positiveLeg, negativeLeg] = [6, 7].map((pin) =>
    components.map((component) => fixturePortId({ db, component, pin })),
  )
  const assembly = artifacts.find(({ path }) =>
    path.endsWith("/native-ibis-assembly.json"),
  )
  assert.ok(assembly)
  const [{ run }]: AssemblyEntry[] = JSON.parse(assembly.body)
  assert.equal(run.stimuli[positiveLeg[0]].inverted, false)
  assert.equal(run.stimuli[negativeLeg[0]].inverted, true)
  assert.deepEqual(
    receiverPaths.map(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
    [positiveLeg, negativeLeg],
  )
  assert.equal(nodeMap[groundSourcePortId], "0")

  const signal = positiveLeg[1]
  const reference = negativeLeg[1]
  assert.equal(plan.probes.length, 1)
  const [probe] = plan.probes
  assert.equal(probe.signalSourceId, signal)
  assert.equal(probe.referenceSourceId, reference)
  assert.equal(probe.signalNode, nodeMap[signal])
  assert.equal(probe.referenceNode, nodeMap[reference])

  const nodeMapArtifact = artifacts.find(
    ({ path }) =>
      path === `${bindings.artifactPrefix}/electrical-node-map.json`,
  )
  assert.ok(nodeMapArtifact)
  assert.equal(nodeMapArtifact.owner, "simulation")
  assert.deepEqual(JSON.parse(nodeMapArtifact.body), {
    nodes: nodeMap,
    channelReferenceSourcePortId: groundSourcePortId,
  })
})
