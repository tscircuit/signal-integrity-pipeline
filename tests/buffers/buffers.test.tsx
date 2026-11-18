import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Single from '../support/unit-single-ended'
import { renderSignals } from '../support/signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { generalDeclarations, modelRunDefinition, bindExperiments, electricalSources } from '../../src/simulation'
import { admitBuffers, compileBuffers } from '../../src/buffers'
import { rootScope, sha256 } from '../../src/kernel'

const modelDir = process.env.IBIS_MODEL_DIR

test('real vendor packages and optional references survive public preflight; source hashes are evidence', { skip: !modelDir }, async () => {
  const bytes = await readFile(`${modelDir}/sn74lvc1g04.ibs`)
  const ibis = { 'models/sn74lvc1g04.ibs': bytes }
  const [prepared] = prepareBlocks({ circuitJson: await renderSignals(<Single />), sources: ibis })
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const declarations = generalDeclarations({ circuit: prepared.circuit, geometry, modeling: prepared.settings, controls: prepared.controls })
  const admitted = admitBuffers({ models: declarations.models, ibisSources: ibis, scope: rootScope('buffers') })
  const compiled = compileBuffers(admitted.value, declarations.plans, modelRunDefinition)
  assert.doesNotThrow(() => bindExperiments({ ...declarations, electrical: electricalSources(prepared.circuit, prepared.settings, declarations.nodes) }, geometry, compiled))
  for (const model of compiled[0]) {
    assert.equal(model.sourceEvidence.sourceSha256, sha256(bytes))
    assert.equal(model.metadata.packagePolicy, 'vendor')
    assert.match(model.source, /RPKG/)
    for (const pin of model.metadata.pins) assert.ok(!Object.hasOwn(pin.references, 'external'))
  }
})
