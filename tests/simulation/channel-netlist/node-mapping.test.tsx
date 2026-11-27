import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { fixturePortId } from "../../fixtures/channel-netlist"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("allocates distinct SPICE nodes for each leg of a routed differential channel", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const planner = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  planner.solve()
  const [{ bindings }] = planner.getOutput().value
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
  assert.equal(nodes.size, 6)
  assert.deepEqual(
    receiverPaths.map(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
    [6, 7].map((pin) => [
      fixturePortId({ db, component: "TX", pin }),
      fixturePortId({ db, component: "RX", pin }),
    ]),
  )
  assert.equal(nodeMap[groundSourcePortId], "0")

  const signal = fixturePortId({ db, component: "RX", pin: 6 })
  const reference = fixturePortId({ db, component: "RX", pin: 7 })
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
