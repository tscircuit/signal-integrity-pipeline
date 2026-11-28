import { expect, test } from "bun:test"
import { parseIbis } from "@tscircuit/ibis-to-spice"
import { loadInspectorSample } from "../../site/channel-inspector/sample"
import {
  assignIbisModel,
  embeddedModels,
  ibisBaseline,
  ibisDriveScale,
  modelPins,
  resetIbisModel,
  tuneIbisModel,
} from "../../site/workbench/model/ibis"
import { editIbisText } from "../../site/workbench/model/ibis-text"

test("assigning and tuning embedded IBIS changes only the edited component and keeps the original", async () => {
  const circuit = await loadInspectorSample()
  const original = JSON.stringify(circuit)
  const models = embeddedModels(circuit)
  const pin = modelPins({ circuit, models }).find(
    ({ model, pin }) => model.component === "TX" && pin === "1",
  )!
  const assigned = assignIbisModel({
    circuit,
    pin,
    name: "Bidirectional",
    direction: "I/O",
    corner: "minimum",
  })
  const assignedModels = embeddedModels(assigned)
  const selected = modelPins({
    circuit: assigned,
    models: assignedModels,
  }).find(({ id }) => pin.id === id)!
  expect(selected.corner).toBe("minimum")
  expect(selected.name).toContain("__wb_")
  const tuned = tuneIbisModel({
    circuit: assigned,
    model: selected.model,
    name: selected.name!,
    scale: 1.5,
    capacitancePf: 2,
  })
  const tunedModel = embeddedModels(tuned)[0]
  const before = selected.model.document!.getBuffer(selected.name!)
  const after = tunedModel.document!.getBuffer(selected.name!)
  expect(after.capacitance[0]).toBe(2e-12)
  expect(after.pullup![0][1]).toBeCloseTo(before.pullup![0][1]! * 1.5)
  expect(embeddedModels(tuned)[1].source).toBe(models[1].source)
  const loaded = ibisBaseline({
    model: selected.model,
    loaded: models[0],
    name: selected.name!,
  })!
  expect(
    ibisDriveScale({
      buffer: after,
      baseline: parseIbis(loaded).getBuffer(selected.name!),
    }),
  ).toBe(1.5)
  const reset = resetIbisModel({
    circuit: tuned,
    model: tunedModel,
    baseline: loaded,
    name: selected.name!,
  })
  expect(embeddedModels(reset)[0].document!.getBuffer(selected.name!)).toEqual(
    before,
  )
  const equalsSource = models[0]
    .source!.replaceAll("C_comp ", "C_comp=")
    .replaceAll("dV/dt_r ", "dV/dt_r = ")
    .replaceAll("dV/dt_f ", "dV/dt_f = ")
  const equalsBuffer = parseIbis(
    editIbisText({
      source: equalsSource,
      edit: { name: "Bidirectional", corner: "minimum" },
    }),
  ).getBuffer("Bidirectional")
  const originalBuffer = models[0].document!.getBuffer("Bidirectional")
  expect(equalsBuffer.capacitance[0]).toBe(originalBuffer.capacitance[1])
  expect(equalsBuffer.ramp?.rising[0]).toEqual(originalBuffer.ramp?.rising[1])
  expect(JSON.stringify(circuit)).toBe(original)
})
