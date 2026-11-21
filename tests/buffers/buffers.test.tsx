import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import React from "react"
import { admitBuffers, compileBuffers } from "../../src/buffers"
import { rootScope, sha256 } from "../../src/kernel"
import { generalDeclarations, modelRunDefinition } from "../../src/simulation"
import { admittedBindings, renderSignals } from "../fixtures/signal-render"
import Single from "../fixtures/unit-single-ended"

const modelDir = process.env.IBIS_MODEL_DIR

const description =
  "real vendor packages and optional references survive public preflight; source hashes are evidence"
test.skipIf(!modelDir)(description, async () => {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const ibis = { "models/sn74lvc1g04.ibs": bytes }
  const bindings = admittedBindings({
    circuitJson: await renderSignals({ tree: <Single /> }),
    ibisSources: ibis,
  })
  const declarations = generalDeclarations({
    circuit: bindings.circuitJson,
    mappings: bindings.mappings,
    modeling: bindings.modeling,
    controls: bindings.controls,
  })
  const admitted = admitBuffers({
    models: declarations.models,
    ibisSources: ibis,
    scope: rootScope("buffers"),
  })
  const compiled = compileBuffers({
    admitted: admitted.value,
    plans: declarations.plans,
    define: modelRunDefinition,
  })
  for (const model of compiled[0]) {
    assert.equal(model.sourceEvidence.sourceSha256, sha256(bytes))
    assert.equal(model.metadata.packagePolicy, "vendor")
    assert.match(model.source, /RPKG/)
    for (const pin of model.metadata.pins)
      assert.ok(!Object.hasOwn(pin.references, "external"))
  }
})
