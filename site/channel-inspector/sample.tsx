import { Circuit } from "@tscircuit/core"
import type { CircuitJson } from "../../src/board"
import { Wire } from "../../tests/fixtures/copper-scope-board"
import {
  ParallelBus,
  parallelBusSources,
} from "../../tests/fixtures/parallel-bus"

/** Use a one millimetre screen to separate the sample's adjacent and spare traces. */
export const sampleScopeDistanceMm = 1

/** Render the parallel bus and its spare route in the browser with no external models. */
export async function loadInspectorSample(): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <ParallelBus
      simulationName="Parallel bus"
      aggressorPattern="0101"
      duration="300ns"
    >
      <Wire name="SPARE" y={-4.5} extent={7} width={0.25} />
    </ParallelBus>,
  )
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson().map((record) => {
    if (record.type !== "simulation_ibis_model") return record
    const text = parallelBusSources[
      record.ibis_model_asset.project_relative_path
    ]
      // Finite package supply resistance avoids a loop of ideal voltage sources in ngspice.
      .replace("R_pkg 0 0 0", "R_pkg 0.05 0.05 0.05")
    return {
      ...record,
      ibis_model_asset: {
        ...record.ibis_model_asset,
        url: `data:text/plain,${encodeURIComponent(text)}`,
      },
    }
  })
}
