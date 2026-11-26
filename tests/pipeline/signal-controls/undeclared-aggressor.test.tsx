import { test } from "bun:test"
import assert from "node:assert/strict"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("planning requires a state for retained aggressors", async () => {
  const circuit = await renderSignals({ tree: <ParallelBus /> })
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: parallelBusSources }),
    /TX[.]DQ1.*aggressorPattern.*aggressorDisabled/,
  )
})
