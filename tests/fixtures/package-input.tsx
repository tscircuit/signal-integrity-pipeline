import { cju } from "@tscircuit/circuit-json-util"
import type { SimulationIbisModel } from "../../src/board"
import type { ModelRunDefinition } from "../../src/buffers"
import { Board } from "./coupled-package"
import { renderSignals } from "./signal-render"

/** Render the board and read its declared IBIS pin bindings. */
export async function renderPackageModel(
  isPowerBusMerged?: boolean,
): Promise<SimulationIbisModel> {
  const circuit = await renderSignals({
    tree: <Board isPowerBusMerged={isPowerBusMerged} />,
  })
  const [model] = cju(circuit).simulation_ibis_model.list()
  if (!model) throw new Error("Missing TSX IBIS model")
  return model
}

/** Build a two-input run from the board's declared IBIS model. */
export function packageInput(model: SimulationIbisModel): ModelRunDefinition {
  const pinMap = model.ibis_pin_name_to_source_port_id
  return {
    definition: {
      source: { file: model.ibis_model_asset.project_relative_path },
      component: model.ibis_component_name,
      pinMap,
      corner: "typical",
      packagePolicy: "vendor",
    },
    run: {
      duration: "1ns",
      pinStates: {
        [pinMap.A1]: { mode: "input" },
        [pinMap.B1]: { mode: "input" },
      },
      stimuli: {},
    },
  }
}
