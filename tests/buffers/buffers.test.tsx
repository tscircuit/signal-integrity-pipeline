import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { cloneCircuitJson } from "../../src/board"
import { compileBuffers, validateIbisSources } from "../../src/buffers"
import { rootScope, sha256 } from "../../src/kernel"
import { generalDeclarations, modelRunDefinition } from "../../src/simulation"
import { plannedBindings, renderSignals } from "../fixtures/signal-render"
import Single from "../fixtures/unit-single-ended"

const modelDir = process.env.IBIS_MODEL_DIR || "models"

const description =
  "real vendor packages and optional references survive channel planning and conversion; source hashes are evidence"
test(description, async () => {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const ibis = { "models/sn74lvc1g04.ibs": bytes }
  const bindings = plannedBindings({
    circuitJson: await renderSignals({ tree: <Single /> }),
    ibisSources: ibis,
  })
  const declarations = generalDeclarations({
    circuit: cloneCircuitJson(bindings.circuitJson),
    receiverPaths: bindings.receiverPaths,
    modeling: bindings.modeling,
    controls: bindings.controls,
  })
  const validated = validateIbisSources({
    models: declarations.models,
    ibisSources: ibis,
    scope: rootScope("buffers"),
  })
  const compiled = compileBuffers({
    validated: validated.value,
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
