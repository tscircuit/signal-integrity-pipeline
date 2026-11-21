import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit, simulation } from "@tscircuit/core"
import {
  convertIbisModelToSpice,
  cornerValue,
  type IbisDocument,
  interpolate,
  logicalBitSchedule,
  parseIbis,
  switchingWeights,
} from "@tscircuit/ibis-to-spice"
import React from "react"
import { createNativeSolver } from "../../src/adapters"
import type { ModelRunDefinition } from "../../src/buffers"
import { referenceVoltages } from "../../src/buffers/inspect"
import { convertPackaged } from "../../src/buffers/package"
import { convertSwitching } from "../../src/buffers/switching"
import {
  lineRanges,
  splitWords,
  subcircuitHeader,
} from "../../src/buffers/text"
import { sha256 } from "../../src/kernel"
import { vendorAvailable, vendorText } from "../fixtures/vendor-models"
import {
  crossingTime,
  ngspiceAvailable,
  runGoldenDeck,
  valueAt,
} from "../support/golden-checks"

setDefaultTimeout(150_000)

// Original two-fixture CMOS model: the edge finishes at 0.8 ns, but the
// acquisition includes a flat tail to 4 ns. No vendor data is copied here.
const source = `[IBIS Ver] 4.2
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
            const value = voltage / 2 + 0.75 * swing
            return `${time}n ${value} ${value} ${value}`
          })
          .join("\n"),
    ),
  )
  .join("\n")}
[End]`

/** Time in seconds and the corresponding value in a generated SPICE trace. */
type SpiceSamples = Array<[seconds: number, value: number]>

/** Recover emitted PWL knots so assertions exercise the electrical artifact. */
function points({
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
  const values = splitWords(pointText!).map(Number)
  return values
    .filter((_, i) => i % 2 === 0)
    .map((value, i) => [value, values[i * 2 + 1]])
}

/** Alter the explicit run without altering caller-owned inputs. */
function run({
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
function convert({
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
async function switchingInput(): Promise<ModelRunDefinition> {
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
  const model = circuit
    .getCircuitJson()
    .find((record) => record.type === "simulation_ibis_model")!
  if (model.type !== "simulation_ibis_model")
    throw new Error("Missing TSX IBIS model")
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

test("truncates a settled acquisition tail", async () => {
  const input = await switchingInput()
  const saved = structuredClone(input)
  const converted = convertPackaged({
    bytes: new TextEncoder().encode(source),
    input,
  })
  assert.throws(
    () =>
      convertIbisModelToSpice(
        source,
        { ...input.definition, packagePolicy: "omit" },
        input.run,
      ),
    { code: "overlapping_edges" },
  )
  assert.match(converted.source, /VKU0 .*PWL/)
  assert.match(converted.source, /VKD0 .*PWL/)
  assert.equal(converted.sourceSha256, sha256(source))
  assert.deepEqual(input, saved)
  const originalDurations = converted.metadata.switchingTails?.map((tail) => [
    tail.edge,
    tail.originalDurationSeconds,
  ])
  assert.deepEqual(originalDurations, [
    ["rising", 4e-9],
    ["falling", 4e-9],
  ])
  for (const tail of converted.metadata.switchingTails!) {
    assert.ok(Math.abs(tail.retainedDurationSeconds - 0.8e-9) < 1e-20)
    assert.equal(tail.coefficientTolerance, 0.01)
    assert.ok(tail.maxCoefficientDeviation <= 0.01)
    for (const fixture of tail.fixtures)
      assert.ok(fixture.maxDeviationVolts <= fixture.toleranceVolts)
  }
  assert.ok(
    converted.warnings.some((warning) =>
      warning.includes("inactive tails truncated"),
    ),
  )
})

test("holds coefficients across measured edges", async () => {
  const input = await switchingInput()
  const converted = convert({ next: input })
  const knots = points({ text: converted.source, label: "KU" })
  assert.ok(knots.every((row, i) => i === 0 || row[0] > knots[i - 1][0]))
  assert.equal(knots.at(-1)![0], 5e-9)
  assert.ok(interpolate(knots, 1e-9) > 0.99)
  assert.ok(interpolate(knots, 2.25e-9) < 0.01)
  // A femtosecond hold before each table forced the routed DDR deck below ngspice's minimum step.
  const table = switchingWeights(
    parseIbis(source).getBuffer("driver"),
    "typical",
    "rising",
  )
  const resolution = Math.min(
    ...table.slice(1).map((row, i) => row[0] - table[i][0]),
  )
  for (const label of ["KU", "KD"] as const) {
    const column = points({ text: converted.source, label })
    const minimumInterval = resolution * (1 - 1e-9)
    const intervalsValid = column.every(
      (row, i) => i === 0 || row[0] - column[i - 1][0] >= minimumInterval,
    )
    assert.ok(
      intervalsValid,
      `${label} has no stitch interval finer than the IBIS table`,
    )
    const edge = column.findIndex((row) => Math.abs(row[0] - 1.25e-9) < 1e-18)
    assert.equal(
      column[edge][1],
      column[edge - 1][1],
      `${label} falling edge starts from the held coefficient`,
    )
  }
  const repeated = convert({
    next: run({ input, bits: "1111100000", interval: "0.25ns" }),
  })
  assert.deepEqual(
    points({ text: repeated.source, label: "KU" }),
    knots,
    "identical bits never retrigger an edge",
  )
})

test("rejects an unsettled edge", async () => {
  const input = await switchingInput()
  assert.throws(
    () => convert({ next: run({ input, bits: "10", interval: "0.25ns" }) }),
    /has not settled before the next edge/,
  )
  const late = source.replace("2n 0.75 0.75 0.75", "2n 0.5 0.5 0.5")
  assert.throws(
    () => convert({ next: input, text: late }),
    /has not settled before the next edge/,
    "a late excursion invalidates an earlier plateau",
  )
  const mismatch = source.replace("4n 0.75 0.75 0.75", "4n 0.73 0.73 0.73")
  assert.throws(
    () => convert({ next: input, text: mismatch }),
    /has not settled before the next edge/,
    "flat fixture endpoints cannot hide nonsteady coefficients",
  )
  // A 100 pF die has a 2.5 ns fixture time constant. Its coefficients are
  // already steady, but the measured voltage is still changing at 1.25 ns.
  const preamble = source
    .slice(0, source.indexOf("[Rising Waveform]"))
    .replace("C_comp 1p 1p 1p", "C_comp 100p 100p 100p")
  const waveforms = (["Rising", "Falling"] as const).flatMap((edge) =>
    [0, 1.5].map((voltage) => {
      const header = `[${edge} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}`
      const rows = Array.from({ length: 801 }, (_, i) => {
        const time = i * 0.025
        let fraction = Math.exp(-time / 2.5)
        if (edge === "Rising") fraction = 1 - fraction
        const value = voltage / 2 + 0.75 * fraction
        return `${time}n ${value} ${value} ${value}`
      })
      return `${header}\n${rows.join("\n")}`
    }),
  )
  const slowFixture = `${preamble}${waveforms.join("\n")}\n[End]`
  const slowWeights = switchingWeights(
    parseIbis(slowFixture).getBuffer("driver"),
    "typical",
    "rising",
  )
  assert.ok(
    slowWeights.every(
      (row) => Math.abs(row[1] - 1) <= 0.01 && Math.abs(row[2]) <= 0.01,
    ),
  )
  assert.throws(
    () => convert({ next: input, text: slowFixture }),
    /has not settled before the next edge/,
    "coefficient settling alone does not authorize voltage tail truncation",
  )
})

test("checks settlement at the selected corner", async () => {
  const input = await switchingInput()
  const slow = source.replace("2n 0.75 0.75 0.75", "2n 0.75 0.5 0.75")
  assert.doesNotThrow(() => convert({ next: input, text: slow }))
  const minimum = {
    ...input,
    definition: { ...input.definition, corner: "minimum" as const },
  }
  assert.throws(() => convert({ next: minimum, text: slow }), /has not settled/)
})

test("interpolates a run ending during an edge", async () => {
  const input = await switchingInput()
  const finite = run({
    input,
    bits: "1",
    interval: "1.25ns",
    duration: "0.5ns",
  })
  const original = convertIbisModelToSpice(
    source,
    { ...finite.definition, packagePolicy: "omit" },
    finite.run,
  )
  assert.deepEqual(
    points({ text: convert({ next: finite }).source, label: "KU" }),
    points({ text: original.source, label: "KU" }),
    "finite window interpolates inside the measured transition",
  )
})

test("leaves idle schedules without tails", async () => {
  const input = await switchingInput()
  const idle = run({ input, bits: "0", interval: "1.25ns" })
  assert.equal(convert({ next: idle }).metadata.switchingTails, undefined)
  assert.doesNotThrow(() =>
    convert({
      next: idle,
      text: source.replaceAll("[Rising Waveform]", "[Falling Waveform]"),
    }),
  )
})

test("rejects invalid stimulus bits", async () => {
  const input = await switchingInput()
  assert.throws(
    () => convert({ next: run({ input, bits: "2", interval: "1.25ns" }) }),
    { code: "invalid_pattern" },
  )
})

test("honors an inverted delayed stimulus", async () => {
  const input = await switchingInput()
  const pinMap = input.definition.pinMap
  const inverted = run({ input, bits: "10", interval: "1.25ns" })
  inverted.run.stimuli[pinMap["1"]].inverted = true
  inverted.run.stimuli[pinMap["1"]].startTime = "0.625ns"
  const shifted = convert({ next: inverted })
  const invertedSchedule = logicalBitSchedule(
    inverted.run.stimuli[pinMap["1"]],
    "5ns",
  )
  assert.equal(shifted.metadata.pins[0].stimulusHash, invertedSchedule.sha256)
  assert.equal(points({ text: shifted.source, label: "KU" })[0][1], 1)
  assert.ok(
    interpolate(points({ text: shifted.source, label: "KU" }), 0.6e-9) > 0.99,
  )
})

test("retains full acquisition when it fits", async () => {
  const input = await switchingInput()
  const table = switchingWeights(
    parseIbis(source).getBuffer("driver"),
    "typical",
    "rising",
  )
  const resolution = Math.min(
    ...table.slice(1).map((row, i) => row[0] - table[i][0]),
  )
  const long = run({ input, bits: "10", interval: "5ns", duration: "10ns" })
  assert.equal(convert({ next: long }).metadata.switchingTails, undefined)
  const longDie = convertIbisModelToSpice(
    source,
    { ...long.definition, packagePolicy: "omit" },
    long.run,
  )
  const upstream = points({ text: longDie.source, label: "KU" })
  const upstreamKnots = upstream.filter(
    (row, i) => !(upstream[i + 1]?.[0] - row[0] < resolution / 2),
  )
  assert.deepEqual(
    points({ text: convert({ next: long }).source, label: "KU" }),
    upstreamKnots,
    "upstream knots without its femtosecond hold",
  )
  assert.doesNotThrow(
    () =>
      convert({
        next: run({ input, bits: "10", interval: "4ns", duration: "8ns" }),
      }),
    "a settled table ending exactly at the next trigger is valid",
  )
})

test("honors inverting buffer polarity", async () => {
  const input = await switchingInput()
  const pinMap = input.definition.pinMap
  const inversePolarity = source.replace(
    "Polarity Non-Inverting",
    "Polarity Inverting",
  )
  const polarity = convert({
    next: run({ input, bits: "10", interval: "1.25ns" }),
    text: inversePolarity,
  })
  const invertingSchedule = logicalBitSchedule(
    input.run.stimuli[pinMap["1"]],
    "5ns",
    "inverting",
  )
  assert.equal(polarity.metadata.pins[0].stimulusHash, invertingSchedule.sha256)
  assert.equal(points({ text: polarity.source, label: "KU" })[0][1], 1)
})

test.skipIf(!process.env.SI_TEST_SWITCHING_NGSPICE)(
  "matches the full acquisition in ngspice",
  async () => {
    const input = await switchingInput()
    const pinMap = input.definition.pinMap
    const converted = convert({ next: input })
    const long = run({ input, bits: "10", interval: "5ns", duration: "10ns" })
    const solve = createNativeSolver({
      timeoutMs: 10000,
      tools: { ngspice: process.env.NGSPICE_BIN ?? "ngspice" },
    })
    const traces: SpiceSamples[] = []
    for (const [model, duration] of [
      [converted, "5n"],
      [convert({ next: long }), "10n"],
    ] as const) {
      const nodes = Object.values(model.spicePinMapping).map((port) => {
        if (port === pinMap["1"]) return "out"
        if (port === pinMap["2"]) return "vdd"
        return "vss"
      })
      const name = subcircuitHeader(model.source)![1]
      const deck = [
        "Buffer-only settled tail oracle",
        model.source,
        `XU ${nodes.join(" ")} ${name}`,
        "Rload out vss 50",
        ".control",
        "set wr_singlescale",
        "set wr_vecnames",
        `tran 2p ${duration}`,
        "wrdata waveform.dat v(out)",
        "quit",
        ".endc",
        ".end",
        "",
      ].join("\n")
      const output = await solve({
        solver: "ngspice",
        files: { "buffer.cir": deck },
        args: ["-n", "-b", "buffer.cir"],
        outputFiles: ["waveform.dat"],
      })
      assert.doesNotMatch(
        `${output.stdout}${output.stderr}`,
        /error|fatal|aborted|timestep too small/i,
      )
      const rows = output.files["waveform.dat"].trim().split("\n").slice(1)
      traces.push(
        rows.map(
          (line) => splitWords(line.trim()).map(Number) as SpiceSamples[number],
        ),
      )
    }
    for (const time of [0.1e-9, 0.3e-9, 0.5e-9, 0.7e-9, 1e-9]) {
      assert.ok(
        Math.abs(interpolate(traces[0], time) - interpolate(traces[1], time)) <
          0.002,
      )
      const shortBit = interpolate(traces[0], 1.25e-9 + time)
      const fullAcquisition = interpolate(traces[1], 5e-9 + time)
      const difference = Math.abs(shortBit - fullAcquisition)
      assert.ok(
        difference < 0.002,
        "short-bit and full-acquisition falling responses agree within 2 mV",
      )
    }
  },
)

// ---- Golden check against the vendor's own data. Each [Rising/Falling Waveform] table was
// measured or simulated by the vendor into its stated fixture; the converter derives its switching coefficients from
// exactly these tables (two per edge), so replaying the converted die buffer into the same fixture must reproduce them.
// Declared metric and tolerance, fixed before any replay: max |V_sim - V_table| over the table's own time points
// <= 2% of the table swing (30 mV on 1.5 V, well inside DDR3's 175 mV VIH(ac) - VREF margin, JESD79-3F section 9),
// and |t50_sim - t50_table| <= 10 ps at the table's mid-swing
// (0.8% of the 1.25 ns unit interval at the board's 800 Mb/s DQ rate).
// R_dut, L_dut, C_dut, C_fixture and L_fixture are zero in every selected table (the parser rejects others).
/** Read the name from the first generated .subckt declaration. */
function firstSubcircuitName(source: string): string | undefined {
  const prefix = ".subckt "
  const lines = source
    .replaceAll("\r", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .split("\n")
  for (const line of lines) {
    if (!line.startsWith(prefix)) continue
    let end = prefix.length
    while (end < line.length && line[end].trim() !== "") end++
    if (end > prefix.length) return line.slice(prefix.length, end)
  }
}

const replays = [
  {
    file: "sprm552c.ibs",
    component: "am335x_zcz",
    pin: "M3",
    power: "E5",
    ground: "A1",
    model: "Model_336",
    role: "AM335x DQ write",
  },
  {
    file: "sprm552c.ibs",
    component: "am335x_zcz",
    pin: "F3",
    power: "E5",
    ground: "A1",
    model: "Model_352",
    role: "AM335x address/command",
  },
  {
    file: "sprm552c.ibs",
    component: "am335x_zcz",
    pin: "D2",
    power: "E5",
    ground: "A1",
    model: "Model_343",
    role: "AM335x CK",
  },
  {
    file: "W631GG6MB-12.ibs",
    component: "W631GG6MB-12",
    pin: "E3",
    power: "A1",
    ground: "B1",
    model: "DATA_34",
    role: "Winbond DQ read 34 ohm",
  },
  {
    file: "W631GG6MB-12.ibs",
    component: "W631GG6MB-12",
    pin: "E3",
    power: "A1",
    ground: "B1",
    model: "DATA_40",
    role: "Winbond DQ read 40 ohm",
  },
] as const

/** Allow 2% of the swing error and a 10 ps shift in the half-height crossing. */
const REPLAY_SWING_ERROR = 0.02
const REPLAY_CROSSING_ERROR_SECONDS = 10e-12

const fixtureReplay = `golden stage 4: vendor DDR3 buffers replayed into their own IBIS fixtures ${"reproduce the vendor waveforms"}`
const replayFiles = [...new Set(replays.map((replay) => replay.file))]
const skipReplay =
  process.env.SI_NATIVE_TESTS !== "1" ||
  !ngspiceAvailable() ||
  !replayFiles.every(vendorAvailable)
test.skipIf(skipReplay)(fixtureReplay, async () => {
  const texts = new Map<string, string>()
  for (const file of new Set(replays.map((replay) => replay.file))) {
    const text = await vendorText(file)
    texts.set(file, text)
  }
  const documents = new Map<string, IbisDocument>(
    [...texts].map(([file, text]) => [file, parseIbis(text)]),
  )
  const records: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const replay of replays) {
    const text = texts.get(replay.file)!
    const document = documents.get(replay.file)!
    const buffer = document.getBuffer(replay.model)
    const rails = referenceVoltages({ buffer })
    const oneSupply = rails.pullup === rails.powerClamp
    const commonGround = rails.pulldown === 0 && rails.groundClamp === 0
    if (buffer.polarity === "inverting" || !oneSupply || !commonGround) {
      throw new Error(
        `${replay.model}: replay assumes a non-inverting buffer with one supply and ground`,
      )
    }
    const duration = Math.max(
      ...buffer.waveforms.map((wave) => wave.data.at(-1)![0]),
    )
    const lines = [
      `* ${replay.role} ${replay.model} fixture replay`,
      `VDD vdd 0 ${rails.pullup}`,
    ]
    const instances: {
      edge: string
      resistance: number
      voltage: number
      table: [number, number][]
    }[] = []
    for (const edge of ["rising", "falling"] as const) {
      let initialState: 0 | 1 = 1
      if (edge === "rising") initialState = 0
      const converted = convertSwitching({
        bytes: new TextEncoder().encode(text),
        input: {
          definition: {
            source: { content: text },
            component: replay.component,
            pinMap: {
              [replay.pin]: "sig",
              [replay.power]: "vdd",
              [replay.ground]: "gnd",
            },
            modelSelections: { [replay.pin]: replay.model },
            references: {
              [replay.pin]: {
                pullup: "vdd",
                pulldown: "gnd",
                powerClamp: "vdd",
                groundClamp: "gnd",
              },
            },
            corner: "typical",
            packagePolicy: "vendor",
          },
          run: {
            duration: duration * 1e3,
            pinStates: { sig: { mode: "output", enabled: true } },
            stimuli: {
              sig: {
                unitInterval: duration * 1e3,
                startTime: 0,
                initialState,
                pattern: {
                  type: "bits",
                  bits: String(1 - initialState),
                  repeat: false,
                },
              },
            },
          },
        },
        document,
      })
      const name = firstSubcircuitName(converted.source)
      assert.ok(name, "converted SPICE must declare a subcircuit")
      lines.push(converted.source)
      for (const wave of buffer.waveforms.filter(
        (entry) => entry.kind === edge,
      )) {
        const k = instances.length
        const nodes = Object.values(converted.spicePinMapping).map((port) => {
          if (port === "sig") return `pad${k}`
          if (port === "vdd") return "vdd"
          return "0"
        })
        const voltage = cornerValue(wave.fixtureVoltage, "typical", "V_fixture")
        lines.push(
          `X${k} ${nodes.join(" ")} ${name}`,
          `RFIX${k} pad${k} fix${k} ${wave.resistance}`,
          `VFIX${k} fix${k} 0 ${voltage}`,
        )
        instances.push({
          edge,
          resistance: wave.resistance,
          voltage,
          table: wave.data.map((row) => [row[0], row[1]!] as [number, number]),
        })
      }
    }
    const probes = instances.map((_, k) => `v(pad${k})`).join(" ")
    lines.push(
      ".control",
      "set wr_singlescale",
      "set wr_vecnames",
      "set numdgt=12",
      `tran 1p ${duration} 0 1p`,
      `wrdata golden.dat ${probes}`,
      "quit",
      ".endc",
      ".end",
    )
    const rows = await runGoldenDeck(`${lines.join("\n")}\n`)
    for (const [k, instance] of instances.entries()) {
      const first = instance.table[0][1]
      const last = instance.table.at(-1)![1]
      const swing = Math.abs(last - first)
      const differences = instance.table.map(([time, value]) =>
        Math.abs(valueAt({ rows, column: k + 1, timeSeconds: time }) - value),
      )
      const error = Math.max(...differences) / swing
      const tableRows = instance.table.map(([time, value]) => [time, value])
      const shift =
        crossingTime({ rows, column: k + 1, level: (first + last) / 2 }) -
        crossingTime({ rows: tableRows, column: 1, level: (first + last) / 2 })
      records.push({
        model: replay.model,
        edge: instance.edge,
        fixture: `${instance.resistance} ohm to ${instance.voltage} V`,
        swingV: +swing.toFixed(4),
        maxErrorPercentOfSwing: +(100 * error).toFixed(3),
        t50ShiftPs: +(shift * 1e12).toFixed(2),
      })
      if (
        !(
          error <= REPLAY_SWING_ERROR &&
          Math.abs(shift) <= REPLAY_CROSSING_ERROR_SECONDS
        )
      ) {
        const fixture = `${instance.resistance} ohm to ${instance.voltage} V`
        failures.push(
          `${replay.model} ${instance.edge} into ${fixture}: error ${error} of swing, t50 shift ${shift} s`,
        )
      }
    }
  }
  console.table(records)
  assert.deepEqual(failures, [])
})
