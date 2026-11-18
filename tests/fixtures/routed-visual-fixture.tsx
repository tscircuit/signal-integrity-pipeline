import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Circuit, simulation } from "@tscircuit/core"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../src/board"
import { formatSpiceVectors } from "../../src/observation"
import { RoutedPipelineSolver } from "../../src/pipeline"
import type { SolverContext } from "../../src/solver"
import { savedVectors, transientDuration, voltageNames } from "./routed-deck"

/** Build the synthetic 3.3 V model with the specified package resistance in ohms. */
function singleEndedIbis({
  packageResistanceOhms,
}: {
  packageResistanceOhms: number
}): string {
  return `[IBIS Ver] 4.2
[Component] LVC1G04_DCK
[Manufacturer] Drawing fixture
[Package]
R_pkg ${packageResistanceOhms} ${packageResistanceOhms} ${packageResistanceOhms}
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
2 A LVC1G04_IN_33
3 GND GND
4 Y LVC1G04_OUT_33
5 VCC POWER
[Model] LVC1G04_OUT_33
Model_type Output
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[Pullup]
-3.3 .066 .066 .066
0 0 0 0
6.6 -.132 -.132 -.132
[Pulldown]
-3.3 -.066 -.066 -.066
0 0 0 0
6.6 .132 .132 .132
[Ramp]
dV/dt_r 1.98/1n 1.98/1n 1.98/1n
dV/dt_f 1.98/1n 1.98/1n 1.98/1n
R_load = 50
${(["Rising", "Falling"] as const)
  .flatMap((kind) =>
    [0, 3.3].map(
      (voltage) =>
        `[${kind} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n${[
          [0, 0],
          [0.2, 0],
          [0.4, 0.5],
          [0.6, 1],
          [0.8, 1],
          [1, 1],
          [2, 1],
          [4, 1],
        ]
          .map(([time, fraction]) => {
            let amplitude = fraction
            if (kind === "Falling") amplitude = 1 - fraction
            const value = voltage / 2 + 1.65 * amplitude
            return `${time}n ${value} ${value} ${value}`
          })
          .join("\n")}`,
    ),
  )
  .join("\n")}
[Model] LVC1G04_IN_33
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[End]
`
}

/** Finite package resistance separates the ideal die supplies from the board supply in ngspice. */
const PACKAGE_RESISTANCE_OHMS = 0.05

export const routedVisualIbis = singleEndedIbis({ packageResistanceOhms: 0 })
export const quietDriverIbis = singleEndedIbis({
  packageResistanceOhms: PACKAGE_RESISTANCE_OHMS,
})

const outputModel = routedVisualIbis
  .split("[Model] LVC1G04_OUT_33")[1]
  .split("[Model] LVC1G04_IN_33")[0]
  .replace("Model_type Output", "Model_type I/O")

export const differentialIbis = `[IBIS Ver] 4.2
[Component] SN65HVD72D
[Manufacturer] Synthetic fixture
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
5 GND GND
6 A a_b_p
7 B a_b_n
8 VCC POWER
[Diff_pin] inv_pin vdiff tdelay_typ tdelay_min tdelay_max
6 7 0.2V 0 0 0
[Model] a_b_p${outputModel}[Model] a_b_n${outputModel}[End]
`

export const separateClampIbis = routedVisualIbis
  .replace(
    "5 VCC POWER\n",
    `5 VCC POWER
6 PC POWER
[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref ext_ref
2 GND VCC GND PC NC
3 GND NC GND NC NC
4 GND VCC GND PC NC
5 NC VCC NC NC NC
6 NC NC NC PC NC
`,
  )
  .replaceAll(
    "[Voltage Range] 3.3 3.3 3.3\n",
    `[Voltage Range] 3.3 3.3 3.3
[Power Clamp Reference] 1.8 1.8 1.8
[Power Clamp]
-10 -0.1 -0.1 -0.1
10 0.1 0.1 0.1
`,
  )

interface RoutedVisualFixture {
  root: RoutedPipelineSolver
}

const fixtures = new Map<number, Promise<RoutedVisualFixture>>()

/** Swap the board's single simulation declaration for the two-block fixture. */
function twoBlockBoard(
  board: ReturnType<typeof TwoTraceBoard>,
): ReturnType<typeof TwoTraceBoard> {
  const children = React.Children.toArray(board.props.children).filter(
    (child) =>
      !React.isValidElement(child) ||
      child.type !== simulation.pcbtransientchannelsimulation,
  )
  const blocks = [0, 1].map((i) => (
    <simulation.pcbtransientchannelsimulation
      key={i}
      name={`BLOCK${i}`}
      bitRate="400Mbps"
      duration={4e-9}
    >
      <simulation.pcbdriverreceiverchannel
        name={`DATA${i}`}
        driverRef={`.TX${i} > .Y`}
        receiverRef={`.RX${i} > .A`}
        pattern="01"
      />
    </simulation.pcbtransientchannelsimulation>
  ))
  return React.cloneElement(board, {}, ...children, ...blocks)
}

/** Return one of the synthetic voltage series shown in the drawings. */
function fixtureVoltage(probe: number): number[] {
  if (probe === 0) return [0, 0.8, 2.1, 1.5, 1.5]
  if (probe === 1) return [0, 0.1, -0.5, 0.05, 0]
  return [3.3, 3.3, 3.3, 3.3, 3.3]
}

// Synthetic engine IO for drawing only.
const context: SolverContext = {
  progress: (): void => undefined,
  runSolver: async (request) => {
    const deck = request.files["simulation.cir"]
    const duration = transientDuration(deck)
    const names = voltageNames(savedVectors(deck))
    const times = [
      0,
      duration * 0.2,
      duration * 0.21,
      duration * 0.25,
      duration,
    ]
    const raw = formatSpiceVectors([
      { name: "time", type: "time", values: times },
      ...names.map((name, i) => ({
        name: `v(${name})`,
        type: "voltage",
        values: fixtureVoltage(i),
      })),
    ])
    return { stdout: "", stderr: "", files: { "waveform.raw": raw } }
  },
}

/** Render and solve the visual fixture with original drawing-only model tables. */
async function solveVisualFixture(
  blocks: number,
): Promise<RoutedVisualFixture> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  const board = TwoTraceBoard({
    "bit-rate": "400Mbps",
    "duration-seconds": 4e-9,
  })
  let tree = board
  if (blocks !== 1) tree = twoBlockBoard(board)
  circuit.add(tree)
  await circuit.renderUntilSettled()
  const root = new RoutedPipelineSolver(
    {
      circuitJson: circuit.getCircuitJson() as CircuitJson,
      ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
      scopeDistanceMm: 1,
    },
    context,
  )
  await root.solveAsync()
  return { root }
}

/** Solve real TwoTraceBoard TSX once per block count in each test file. */
export function routedVisualFixture(blocks = 1): Promise<RoutedVisualFixture> {
  const existing = fixtures.get(blocks)
  if (existing) return existing
  const fixture = solveVisualFixture(blocks)
  fixtures.set(blocks, fixture)
  return fixture
}

/** Compare actual exported SVG, including explicit text and fills; snapshots contain no vendor data. */
export function assertRouteVisual(
  drawing: GraphicsObject,
  module: string,
  name: string,
): void {
  const path = join(
    import.meta.dirname,
    "..",
    module,
    "__snapshots__",
    `${name}.snap.svg`,
  )
  // Ignore sub-micro-atlas-unit V8/JavaScriptCore rounding in display coordinates only.
  const serialized = JSON.stringify(drawing, (_key, value) => {
    if (typeof value === "number") return Number(value.toFixed(6))
    return value
  })
  const normalized: GraphicsObject = JSON.parse(serialized)
  const svg = getSvgFromGraphicsObject(normalized, {
    svgWidth: 1100,
    svgHeight: 800,
    backgroundColor: "white",
    includeTextLabels: false,
  })
  if (process.env.UPDATE_ROUTED_VISUALS === "1") {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, svg)
  }
  assert.equal(
    svg,
    readFileSync(path, "utf8"),
    `${module}/${name} SVG changed; inspect PNGs before updating snapshots`,
  )
}
