import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"

test("honors a caller's iteration limit below the model count", async () => {
  const solver = new ChannelNetlistSolver(await renderTwoTraceNetlistInput())
  solver.MAX_ITERATIONS = 2
  solver.solve()
  assert.equal(solver.iterations, 2)
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /netlist is incomplete/)
})
