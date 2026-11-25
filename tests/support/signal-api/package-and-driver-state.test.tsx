import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { compileBuffers, validateIbisSources } from "../../../src/buffers"
import { rootScope } from "../../../src/kernel"
import {
  generalDeclarations,
  modelRunDefinition,
} from "../../../src/simulation"
import { readSignalApiModels } from "../../fixtures/signal-api"
import {
  plannedBindings,
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"
import Single from "../../fixtures/unit-single-ended"

test("keeps vendor parasitics and rejects disabling an output-only driver", async () => {
  const disabledCircuit = await renderSignals({
    tree: <Single driverDisabled />,
  })
  const ibis = await readSignalApiModels()
  assert.throws(
    () =>
      prepareChannelSimulations({ circuit: disabledCircuit, sources: ibis }),
    /has no disabled state/,
  )
  const circuit = await renderSignals({ tree: <Single pattern="0" /> })
  const bindings = plannedBindings({
    circuitJson: circuit,
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
  const [compiled] = compileBuffers({
    validated: validated.value,
    plans: declarations.plans,
    define: modelRunDefinition,
  })
  for (const model of compiled) {
    assert.equal(model.metadata.packagePolicy, "vendor")
    assert.match(model.source, /RPKG/)
    assert.match(model.source, /LPKG/)
    assert.match(model.source, /CPKG/)
    assert.equal(
      model.metadata.packageData.mappedPins.filter(
        (p) => p.role === "reference",
      ).length,
      2,
    )
  }
  assert.ok(
    compiled[0].metadata.pins.some(
      (p) => p.runState.mode === "output" && p.runState.enabled,
    ),
  )
})
