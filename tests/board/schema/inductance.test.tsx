import { test } from "bun:test"
import assert from "node:assert/strict"
import { validateCircuitRecords } from "../../../src/board"
import { renderCoreSignals } from "../../support/core-render"

test("accepts canonical inductance rendered by core", async () => {
  const circuit = await renderCoreSignals(
    <board schematicDisabled>
      <inductor name="L_PWR3" inductance="1.5uH" footprint="0402" />
    </board>,
  )
  const inductor = circuit.find(
    (record) =>
      record.type === "source_component" && record.ftype === "simple_inductor",
  )
  assert.equal(inductor?.inductance, 0.0000015)
  assert.doesNotThrow(() => validateCircuitRecords(circuit))
})
