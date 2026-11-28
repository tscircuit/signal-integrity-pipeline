/** @jsxRuntime automatic */
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type { CrossSectionConductor } from "../../src/rlgc"
import { renderCoreSignals } from "../support/core-render"

/** Render a rectangular copper footprint and take a cross-section through it. */
export async function renderCrossSectionConductor({
  widthMm,
  zMm,
  thicknessMm,
}: {
  widthMm: number
  zMm: number
  thicknessMm: number
}): Promise<CrossSectionConductor> {
  const circuit = await renderCoreSignals(
    <board width={4} height={4}>
      <chip
        name="Conductor"
        pinLabels={{ pin1: "P" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              width={widthMm}
              height={0.4}
              shape="rect"
            />
          </footprint>
        }
      />
    </board>,
  )
  const [pad] = cju(circuit).pcb_smtpad.list()
  assert.equal(pad.shape, "rect")
  return {
    conductorId: pad.pcb_smtpad_id,
    xMm: pad.x,
    zMm,
    widthMm: pad.width,
    thicknessMm,
  }
}
