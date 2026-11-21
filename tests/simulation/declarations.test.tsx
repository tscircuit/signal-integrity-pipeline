import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import { modelRunDefinition } from "../../src/simulation"
import { Board } from "../fixtures/coupled-package"
import { renderCoreSignals } from "../support/core-render"

/** Keep the model run long enough to build a converter definition. */
const MODEL_DURATION_SECONDS = 2e-9

/** The model run after physical scoping removes pin B1 from the rendered board. */
async function scopedModelDefinition(): Promise<
  ReturnType<typeof modelRunDefinition>["definition"]
> {
  const records = await renderCoreSignals(<Board />)
  const model = records.filter(
    (record) => record.type === "simulation_ibis_model",
  )[0]
  const pinMap = model.ibis_pin_name_to_source_port_id
  const references = {
    pullup_reference_source_port_id: pinMap.V1,
    pulldown_reference_source_port_id: pinMap.G1,
  }
  model.ibis_pin_name_to_model_name = { A1: "input", B1: "input" }
  model.ibis_pin_name_to_reference_source_port_ids = {
    A1: references,
    B1: references,
  }
  // prepareBlocks trims physical mappings after spatial scope selection, retaining these source dictionaries.
  delete pinMap.B1
  const plan = {
    durationSeconds: MODEL_DURATION_SECONDS,
    states: [],
    stimuli: [],
  }
  return modelRunDefinition({ model: { ...model, pipelineId: "scoped" }, plan })
    .definition
}

test("prunes model selections for unused pins", async () => {
  const definition = await scopedModelDefinition()
  assert.deepEqual(Object.keys(definition.modelSelections!), ["A1"])
})

test("prunes references for unused pins", async () => {
  const definition = await scopedModelDefinition()
  assert.deepEqual(Object.keys(definition.references!), ["A1"])
})

test("keeps unused pins out of the pin map", async () => {
  const definition = await scopedModelDefinition()
  assert.ok(!("B1" in definition.pinMap))
})
