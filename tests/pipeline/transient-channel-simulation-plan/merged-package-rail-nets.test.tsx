import { test } from "bun:test"
import assert from "node:assert/strict"
import type React from "react"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter, Reference, simulation } from "../../fixtures/signal-parts"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

/** Give the driver two explicitly bound reference pins that share one package branch. */
function MergedRailBoard({
  clampNet,
}: {
  clampNet: string
}): React.JSX.Element {
  return (
    <board
      width={16}
      height={12}
      layers={4}
      thickness={1.6}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      isViaInPadAllowed
    >
      <Inverter name="TX" x={-5} y={0} driver clampNet={clampNet} />
      <Inverter name="RX" x={5} y={0} driver={false} />
      <trace
        from=".TX > .Y"
        to=".RX > .A"
        width={0.2}
        pcbPath={[".TX > .Y", ".RX > .A"]}
      />
      <trace
        from=".TX > .VCC"
        to=".RX > .VCC"
        width={0.2}
        pcbPath={[".TX > .VCC", ".RX > .VCC"]}
      />
      {clampNet === "net.VCC" && (
        <trace
          from=".TX > .PC"
          to=".TX > .VCC"
          width={0.2}
          pcbPath={[".TX > .PC", ".TX > .VCC"]}
        />
      )}
      {clampNet === "net.CLAMP" && (
        <>
          <net name="CLAMP" />
          <chip
            name="CLAMP_PAD"
            pcbX={-7}
            pcbY={1.2}
            connections={{ pin1: "net.CLAMP" }}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbX={0}
                  pcbY={0}
                  width={0.4}
                  height={0.4}
                  shape="rect"
                />
              </footprint>
            }
          />
          <trace
            from=".TX > .PC"
            to=".CLAMP_PAD > .pin1"
            width={0.2}
            pcbPath={[".TX > .PC", ".CLAMP_PAD > .pin1"]}
          />
        </>
      )}
      <Reference />
      <simulation.pcbtransientchannelsimulation
        name="MERGED"
        bitRate="50Mbps"
        duration="40ns"
      >
        <simulation.pcbdriverreceiverchannel
          name="DATA"
          driverRef=".TX > .Y"
          receiverRef=".RX > .A"
          pattern="01"
        />
      </simulation.pcbtransientchannelsimulation>
    </board>
  )
}

/** Use the same package bus with either a mapped or an unmapped matrix pin. */
function mergedRailIbis(matrixPinName: "5" | "7"): string {
  return routedVisualIbis
    .replace("[Package]", "[Package Model] MergedRail\n[Package]")
    .replace(
      "5 VCC POWER\n",
      `5 VCC POWER
6 PC POWER
7 VCC_MATRIX POWER
[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref ext_ref
2 GND VCC GND VCC NC
3 GND NC GND NC NC
4 GND VCC GND VCC NC
5 NC VCC NC VCC NC
6 NC VCC NC VCC NC
7 NC VCC NC VCC NC
`,
    )
    .replace(
      "[End]",
      `[Define Package Model] MergedRail
[Manufacturer] Fixture
[OEM] Fixture
[Description] Shared supply branch
[Number Of Pins] 1
[Pin Numbers]
${matrixPinName}
[Model Data]
[Inductance Matrix] Full_matrix
[Row] ${matrixPinName}
1n
[Capacitance Matrix] Full_matrix
[Row] ${matrixPinName}
1p
[End Model Data]
[End Package Model]
[End]`,
    )
}

test.failing(
  "requires one board net per merged package rail, even when the matrix pin is unmapped",
  async () => {
    const sameNetBoard = await renderCoreSignals(
      <MergedRailBoard clampNet="net.VCC" />,
    )
    const splitNetBoard = await renderCoreSignals(
      <MergedRailBoard clampNet="net.CLAMP" />,
    )
    for (const matrixPinName of ["5", "7"] as const) {
      const ibisSources = { [inverterModelPath]: mergedRailIbis(matrixPinName) }
      const sameNet = new TransientChannelSimulationPlanSolver({
        circuitJson: sameNetBoard,
        ibisSources,
      })
      sameNet.solve()
      assert.equal(sameNet.getOutput().value.length, 1)

      const splitNet = new TransientChannelSimulationPlanSolver({
        circuitJson: splitNetBoard,
        ibisSources,
      })
      assert.throws(
        () => splitNet.solve(),
        /merged package pins (5 and 6|6 and 5) require the same board net/,
        `matrix pin ${matrixPinName}`,
      )
    }
  },
)
