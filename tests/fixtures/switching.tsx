import { Circuit } from "@tscircuit/core"
import { cju } from "@tscircuit/circuit-json-util"
import React from "react"
import type { ModelRunDefinition } from "../../src/buffers"
import { convertPackaged } from "../../src/buffers/package"
import { lineRanges, splitWords } from "../../src/buffers/text"

// Original two-fixture CMOS model: the edge finishes at 0.8 ns, but the
// acquisition includes a flat tail to 4 ns. No vendor data is copied here.
export const source = `[IBIS Ver] 4.2
[Component] fixture
[Manufacturer] Test
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
1 DQ driver
2 VDD POWER
3 VSS GND
[Model] driver
Model_type I/O
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[Pullup]
-1.5 .03 .03 .03
0 0 0 0
3 -.06 -.06 -.06
[Pulldown]
-1.5 -.03 -.03 -.03
0 0 0 0
3 .06 .06 .06
[Ramp]
dV/dt_r .45/.24n .45/.24n .45/.24n
dV/dt_f .45/.24n .45/.24n .45/.24n
${(["Rising", "Falling"] as const)
  .flatMap((kind) =>
    [0, 1.5].map(
      (voltage) =>
        `[${kind} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n` +
        [
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
            let swing = 1 - fraction
            if (kind === "Rising") swing = fraction
            const fixtureVoltageVolts = voltage / 2 + 0.75 * swing
            return `${time}n ${fixtureVoltageVolts} ${fixtureVoltageVolts} ${fixtureVoltageVolts}`
          })
          .join("\n"),
    ),
  )
  .join("\n")}
[End]`

/** Time in seconds and the corresponding value in a generated SPICE trace. */
type SpiceSamples = Array<[seconds: number, value: number]>

/** Recover emitted PWL knots so assertions exercise the electrical artifact. */
export function points({
  text,
  label,
}: {
  text: string
  label: "KU" | "KD"
}): SpiceSamples {
  const prefix = `V${label}0 `
  let pointText: string | undefined
  for (const { start, end } of lineRanges(text)) {
    const line = text.slice(start, end)
    if (!line.startsWith(prefix) || !line.endsWith(")")) continue
    const open = line.lastIndexOf("PWL(")
    if (open < prefix.length) continue
    pointText = line.slice(open + "PWL(".length, -1)
    break
  }
  if (!pointText) throw new Error(`Missing ${label} PWL points`)
  const pointTokens = splitWords(pointText).map(Number)
  return pointTokens
    .filter((_, i) => i % 2 === 0)
    .map((seconds, i) => [seconds, pointTokens[i * 2 + 1]])
}

/** Alter the explicit run without altering caller-owned inputs. */
export function run({
  input,
  bits,
  interval,
  duration = "5ns",
}: {
  input: ModelRunDefinition
  bits: string
  interval: string
  duration?: string
}): ModelRunDefinition {
  const next = structuredClone(input)
  next.run.duration = duration
  const stimulus = next.run.stimuli[next.definition.pinMap["1"]]
  stimulus.unitInterval = interval
  stimulus.pattern.bits = bits
  return next
}

/** Run an original inline model through the same package and switching boundary. */
export function convert({
  next,
  text = source,
}: {
  next: ModelRunDefinition
  text?: string
}): ReturnType<typeof convertPackaged> {
  const bytes = new TextEncoder().encode(text)
  const definition = { ...next.definition, source: { content: text } }
  return convertPackaged({ bytes, input: { ...next, definition } })
}

/** Render the pin mapping through core before creating the switching run. */
export async function switchingInput(): Promise<ModelRunDefinition> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(
    <board width={10} height={5} routingDisabled schematicDisabled>
      <chip
        name="U1"
        pinLabels={{ 1: "DQ", 2: "VDD", 3: "VSS" }}
        footprint="sot23"
      />
      <pcbnotetext
        text="800 Mbps: 0.8 ns edge, 4 ns acquisition"
        pcbX={0}
        pcbY={2}
      />
      <simulation.ibismodel
        componentRef=".U1"
        ibisModelAsset={{
          project_relative_path: "fixture.ibs",
          url: "./fixture.ibs",
          mimetype: "text/plain",
        }}
        ibisComponentName="fixture"
        ibisPinNameToPortLabel={{ 1: "DQ", 2: "VDD", 3: "VSS" }}
      />
    </board>,
  )
  await circuit.renderUntilSettled()
  const [model] = cju(circuit.getCircuitJson()).simulation_ibis_model.list()
  if (!model) throw new Error("Missing TSX IBIS model")
  const pinMap = model.ibis_pin_name_to_source_port_id
  return {
    definition: {
      source: { content: source },
      component: "fixture",
      pinMap,
      corner: "typical",
      packagePolicy: "vendor",
    },
    run: {
      duration: "5ns",
      pinStates: { [pinMap["1"]]: { mode: "output", enabled: true } },
      stimuli: {
        [pinMap["1"]]: {
          unitInterval: "1.25ns",
          startTime: "0ns",
          initialState: 0,
          pattern: { type: "bits", bits: "10", repeat: true },
        },
      },
    },
  }
}
