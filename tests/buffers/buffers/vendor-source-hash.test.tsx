import { test } from "bun:test"
import assert from "node:assert/strict"
import { validateIbisSources } from "../../../src/buffers"
import { rootScope } from "../../../src/kernel"
import { source } from "../../fixtures/coupled-package"
import { renderPackageModel } from "../../fixtures/package-input"

test("rejects rendered IBIS model declarations when their expected asset hash differs", async () => {
  const model = await renderPackageModel()
  const path = model.ibis_model_asset.project_relative_path
  const request = {
    models: [{ ...model, pipelineId: model.simulation_ibis_model_id }],
    ibisSources: { [path]: source },
    modeling: { ibisModelAssetSha256: { [path]: "0".repeat(64) } },
    scope: rootScope("buffers"),
  }
  assert.throws(() => validateIbisSources(request), { code: "vendor_hash" })
})
