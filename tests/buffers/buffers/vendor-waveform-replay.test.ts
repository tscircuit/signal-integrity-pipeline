import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertIbisModelToSpice,
  cornerValue,
  type IbisDocument,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import { referenceVoltages } from "../../../src/buffers/inspect"
import {
  loadVendorModelText,
  vendorAvailable,
  vendorModels,
} from "../../fixtures/vendor-models"
import {
  crossingTime,
  ngspiceAvailable,
  runGoldenDeck,
  valueAt,
} from "../../support/golden-checks"

setDefaultTimeout(150_000)

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
    const vendorModel = Object.values(vendorModels).find(
      (model) => model.file === file,
    )
    assert.ok(vendorModel, file)
    const text = await loadVendorModelText(vendorModel)
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
      const converted = convertIbisModelToSpice(
        text,
        {
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
          packagePolicy: "omit",
        },
        {
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
      )
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
