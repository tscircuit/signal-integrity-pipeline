import { test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit } from "@tscircuit/core"
import { IbisError } from "@tscircuit/ibis-to-spice"
import { admitBuffers, compileBuffers } from "../../../src/buffers"
import { rootScope } from "../../../src/kernel"
import { modelRunDefinition } from "../../../src/simulation"
import {
  deviceAsset,
  InspectionChip,
  inspectionIbis,
} from "../../fixtures/ibis-inspection"

test("missing_run_state names the component, physical pin and IBIS signal for pins outside the channel", async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board width={10} height={10} schematicDisabled routeRemaining={false}>
      <InspectionChip
        name="U1"
        pinLabels={{
          M1: "DQ0",
          N4: "DDR_DQS0",
          P1: "VDD",
          G1: "VSS",
        }}
        ibisModel={{
          ibisModelAsset: {
            project_relative_path: deviceAsset,
            url: `https://example.com/${deviceAsset}`,
            mimetype: "text/plain",
          },
          ibisComponentName: "Device",
          ibisPinNameToPortLabel: {
            1: "DQ0",
            2: "VDD",
            3: "VSS",
            N4: "DDR_DQS0",
          },
        }}
      />
    </board>,
  )
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  const rawModel = records.find((row) => row.type === "simulation_ibis_model")
  assert.ok(rawModel)
  const model = {
    ...rawModel,
    pipelineId: rawModel.simulation_ibis_model_id,
  }
  const dqPortId = model.ibis_pin_name_to_source_port_id["1"]
  assert.ok(dqPortId)

  const ibisText = inspectionIbis({ extraPin: "N4 DDR_DQS0 Fast" })
  const admitted = admitBuffers({
    models: [model],
    ibisSources: { [deviceAsset]: ibisText },
    modeling: {},
    scope: rootScope("buffers"),
  })
  const plan = {
    durationSeconds: 1e-9,
    states: [{ source_port_id: dqPortId, is_output: false }],
    stimuli: [],
    models: [model],
  }

  assert.throws(
    () =>
      compileBuffers({
        admitted: admitted.value,
        plans: [plan],
        define: modelRunDefinition,
        circuit: records,
      }),
    (error: unknown) => {
      assert.ok(error instanceof IbisError)
      assert.equal(error.code, "missing_run_state")
      assert.equal(
        error.message,
        "U1.N4 (IBIS DDR_DQS0): explicit compatible input/output state is required; set ibisPinStates (e.g. { isOutput: false })",
      )
      return true
    },
  )
})
