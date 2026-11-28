import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import { loadInspectorSample } from "../../site/channel-inspector/sample"
import {
  editStackup,
  stackupImpedance,
} from "../../site/workbench/model/stackup"

test("stackup edits replace the physical stack and change the browser field solve", async () => {
  const circuit = await loadInspectorSample()
  const stack = cju([...circuit]).pcb_stackup.getWhere({})!
  const original = JSON.stringify(circuit)
  const layers = stack.layers.map((layer) => {
    if (layer.layer_type === "dielectric")
      return { ...layer, thickness: layer.thickness * 1.2 }
    return { ...layer }
  })
  const edited = editStackup({ circuit, layers })
  const probe = { signal: "top", reference: "bottom", widthMm: 0.2 } as const
  expect(stackupImpedance({ circuit: edited, ...probe }).ohms).toBeGreaterThan(
    stackupImpedance({ circuit, ...probe }).ohms,
  )
  expect(JSON.stringify(circuit)).toBe(original)
  expect(cju([...edited]).pcb_board.getWhere({})?.thickness).toBeGreaterThan(
    cju([...circuit]).pcb_board.getWhere({})!.thickness,
  )
})
