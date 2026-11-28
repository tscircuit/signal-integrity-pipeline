import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import { loadInspectorSample } from "../../site/channel-inspector/sample"
import {
  editStimulus,
  stimulusRadius,
} from "../../site/workbench/model/stimulus"

test("editing the stimulus updates only the active simulation and its channel", async () => {
  const circuit = await loadInspectorSample()
  const original = JSON.stringify(circuit)
  const db = cju([...circuit])
  const simulation = db.simulation_pcb_transient_channel_simulation.getWhere({})
  const channel = db.simulation_pcb_driver_receiver_channel.getWhere({})
  if (!simulation || !channel) throw new Error("Expected a sample channel.")
  const id = simulation.simulation_pcb_transient_channel_simulation_id
  const edited = editStimulus({
    circuit,
    id,
    edit: {
      name: "Fast bus",
      rateBps: 40e6,
      durationMs: 0.0002,
      radiusMm: 2,
      aggressorPattern: "clock",
      aggressorsDisabled: false,
      channels: {
        [channel.simulation_pcb_driver_receiver_channel_id]: {
          pattern: "prbs7",
          bit_rate_bps: 25e6,
        },
      },
    },
  })
  const updated = cju([...edited])
  expect(
    updated.simulation_pcb_driver_receiver_channel.getWhere({})?.seed,
  ).toBe(1)
  const editedSimulation =
    updated.simulation_pcb_transient_channel_simulation.get(id)
  if (!editedSimulation) throw new Error("Expected the edited simulation.")
  expect(editedSimulation.aggressor_pattern).toBe("clock")
  expect(
    stimulusRadius({
      simulation: editedSimulation,
      defaultMm: 1,
    }),
  ).toBe(2)
  expect(JSON.stringify(circuit)).toBe(original)
})
