import { beforeAll, describe, setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import { type RouteWire, type RouteXY, segmentRoutes } from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import {
  type CrossSection,
  solveCrossSection,
} from "../../src/extraction/cross-section"
import type {
  ExtractedRoutes,
  RouteCoefficients,
} from "../../src/extraction/route-lines"
import {
  type RouteLadder,
  routeLadder,
} from "../../src/simulation/route-ladder"
import type { RouteEndpoint } from "../../src/simulation/route-network"
import { routedCopper } from "../fixtures/routed-copper"
import {
  conductorLossTolerance,
  crossingTime,
  filamentImpedance,
  type GoldenRows,
  ngspiceAvailable,
  runGoldenDeck,
  valueAt,
} from "../support/golden-checks"

setDefaultTimeout(150_000)

/** Retain submicrometre distinctions in stamped endpoint names. */
const COORDINATE_PRECISION = 8

/** Electrical identity follows physical TSX copper endpoints. */
function endpoint({
  wire,
  point,
}: {
  wire: RouteWire
  point: RouteXY
}): string {
  const coordinates = point
    .map((value) => value.toFixed(COORDINATE_PRECISION))
    .join("_")
  return `${wire.layer}_${coordinates}`
}

describe("large routed TSX ladder", () => {
  let result: RouteLadder

  beforeAll(async () => {
    const { circuitJson, scope } = await routedCopper()
    const fields = new RouteFieldsSolver({
      geometry: segmentRoutes({
        circuit: circuitJson,
        scope,
      }),
      artifactPrefix: "test",
    })
    fields.solve()
    result = routeLadder({
      extracted: fields.getOutput().value,
      endpoint,
      riseSeconds: 1e-12,
    })
  })

  test("assembles more than 1024 cells", () => {
    assert.ok(result.cells > 1024)
  })

  test("limits mutual terms to nearby cells", () => {
    const couplings = result.lines.filter((line) => line.startsWith("K"))
    assert.ok(couplings.length > 0)
    assert.ok(
      couplings.length < result.cells * 30,
      "fixed-width local slices scale with cell count",
    )
  })

  test("stamps normalized Foster resistance", () => {
    const coupled = result.lines.some((line) => line.startsWith("GARCS"))
    assert.ok(coupled, "actual TSX copper exercises coupled Foster resistance")
    assert.equal(
      result.lines.filter(
        (line) => line.startsWith("VARCS") || line.startsWith("HARCS"),
      ).length,
      0,
      "tiny Foster voltages must not be differences along sensor/CCVS chains",
    )
    const resistance = result.lines.filter((line) => line.startsWith("RARCS"))
    assert.ok(
      resistance.every(
        (line) => line.split(" ")[2] !== "0" || line.endsWith(" 1"),
      ),
      "coupled resistance equations have unit diagonal",
    )
  })
})

// ---- Golden known-answer checks for stages 5–6. The ladder is the lowest layer that
// builds a plain line: straight parallel wires get the solved per-unit-length matrices of one cross-section.
// Expected values and tolerances are fixed from transmission-line theory before ngspice runs.
/** Vacuum light speed in metres per second for the analytic delay. */
const lightSpeed = 299792458
/** The test ladders model a 100 mm route. */
const lengthMm = 100
/** Use a 100 ps source rise to set the ladder cell spacing. */
const riseSeconds = 100e-12
/** Length tolerance for naming the ladder's two endpoints. */
const ENDPOINT_TOLERANCE_MM = 1e-9
/** Relative tolerance from SPICE's element print precision. */
const ELEMENT_TOLERANCE = 1e-9

/** Ends use near/far names; interior cell boundaries reuse names from this ladder. */
function createStraightEndpoint(): RouteEndpoint {
  const interior = new Map<string, string>()
  return ({ wire, point }) => {
    if (Math.abs(point[0]) < ENDPOINT_TOLERANCE_MM) return `near${wire.id}`
    if (Math.abs(point[0] - lengthMm) < ENDPOINT_TOLERANCE_MM)
      return `far${wire.id}`
    const key = `${wire.id}:${point[0].toFixed(6)}`
    const existing = interior.get(key)
    if (existing !== undefined) return existing
    const node = `n${interior.size}`
    interior.set(key, node)
    return node
  }
}

/** Extracted electrical coefficients and emitted ladder for one straight section. */
interface StraightLine {
  line: RouteCoefficients
  ladder: RouteLadder
}

/** Straight parallel wires along x, one per section conductor; conductor loss is scaled (1e-3 = near-lossless). */
function straightLine({
  section,
  lossScale,
}: {
  section: CrossSection
  lossScale: number
}): StraightLine {
  const solved = solveCrossSection({ section })
  const line: RouteCoefficients = {
    conductorIds: solved.conductorIds,
    C: solved.C,
    C0: solved.C0,
    L: solved.L,
    dielectricLoss: solved.dielectricLoss,
    diagnostics: solved.diagnostics,
    dcResistance: solved.dcResistance.map((row) =>
      row.map((value) => value * lossScale),
    ),
    skinResistance: solved.skinResistance.map((row) =>
      row.map((value) => value * lossScale),
    ),
    stripSkinResistance: solved.stripSkinResistance.map((row) =>
      row.map((value) => value * lossScale),
    ),
  }
  const wires: RouteWire[] = section.conductors.map((conductor, i) => ({
    id: i,
    trace: `t${i}`,
    source: `s${i}`,
    layer: "inner1",
    width: conductor.widthMm,
    a: [0, conductor.xMm],
    b: [lengthMm, conductor.xMm],
    u: [1, 0],
    start: 0,
    end: lengthMm,
    transverse: conductor.xMm,
  }))
  const extracted: ExtractedRoutes = {
    slices: [
      {
        wires,
        start: 0,
        end: lengthMm,
        references: [],
        key: "golden",
        line,
      },
    ],
    sections: [{ key: "golden", line }],
    materials: {
      maskMm: 0,
      maskEr: 1,
      maskLoss: 0,
      substrateLoss: 0,
    },
    warnings: [],
    coupling: [],
  }
  const endpoint = createStraightEndpoint()
  return { line, ladder: routeLadder({ extracted, endpoint, riseSeconds }) }
}

/**
 * Homogeneous er = 4 stripline (b = 1 mm): every mode travels at exactly c/sqrt(er), whatever the field-solver
 * error.
 */
const stripline: CrossSection = {
  conductors: [
    {
      id: "s",
      xMm: 0,
      zMm: 0.4825,
      widthMm: 0.35,
      thicknessMm: 0.035,
    },
  ],
  planes: [{ zMm: 0 }, { zMm: 1 }],
  dielectrics: [
    {
      zMm: 0,
      thicknessMm: 1,
      er: 4,
      lossTangent: 0,
    },
  ],
}
/** Inhomogeneous microstrip pair (h = 0.5 mm, er = 4 below, air above): distinct even and odd velocities. */
const microstripPair: CrossSection = {
  conductors: [-0.375, 0.375].map((x, i) => ({
    id: `m${i}`,
    xMm: x,
    zMm: 0.5,
    widthMm: 0.5,
    thicknessMm: 0.035,
  })),
  planes: [{ zMm: 0 }],
  dielectrics: [
    {
      zMm: 0,
      thicknessMm: 0.5,
      er: 4,
      lossTangent: 0,
    },
  ],
}

/** Match an emitted element name made of the prefix and a decimal index. */
function hasNumberedElement({
  line,
  prefix,
}: {
  line: string
  prefix: string
}): boolean {
  if (!line.startsWith(prefix)) return false
  const end = line.indexOf(" ", prefix.length)
  if (end <= prefix.length) return false
  for (let index = prefix.length; index < end; index++) {
    if (line[index] < "0" || line[index] > "9") return false
  }
  return true
}

/** Sum the values of the numbered elements with the requested prefix. */
function total({ lines, prefix }: { lines: string[]; prefix: string }): number {
  const elements = lines.filter((line) => hasNumberedElement({ line, prefix }))
  return elements.reduce((sum, line) => sum + Number(line.split(" ")[3]), 0)
}

/** Compare elements against the integrated value at the deck's print precision. */
function near({
  actual,
  expected,
}: {
  actual: number
  expected: number
}): boolean {
  return Math.abs(actual - expected) <= ELEMENT_TOLERANCE * Math.abs(expected)
}

test("golden stage 5: ladder elements integrate to L l, C l, R l and K = L12/sqrt(L11 L22)", () => {
  // The ladder must conserve per-unit-length energy: summed series L and DC R equal L l and R l, summed shunt C to
  // ground equals the row sums (C11 + C12) l, summed pair C equals |C12| l, and every K is the section's exact
  // L12/sqrt(L11 L22) (Paul, MTL 2nd ed., section 7.1, lumped-pi discretization). Tolerance 1e-9 relative: the deck
  // prints 12 significant digits.
  const metres = lengthMm / 1000
  for (const [label, section] of [
    ["stripline", stripline],
    ["microstrip pair", microstripPair],
  ] as const) {
    const { line, ladder } = straightLine({ section, lossScale: 1 })
    const size = line.L.length
    const inductance = Array.from(
      { length: size },
      (_, i) => line.L[i][i] * metres,
    ).reduce((a, b) => a + b, 0)
    const seriesResistances = Array.from(
      { length: size },
      (_, i) => line.dcResistance[i][i] * metres,
    )
    const resistance = seriesResistances.reduce((a, b) => a + b, 0)
    const ground = line.C.flat().reduce((a, b) => a + b, 0) * metres
    const shunts = ladder.lines
      .filter((entry) => hasNumberedElement({ line: entry, prefix: "CARCCS" }))
      .map((entry) => entry.split(" "))
    const seriesInductance = total({ lines: ladder.lines, prefix: "LARCL" })
    const seriesResistance = total({ lines: ladder.lines, prefix: "RARCD" })
    assert.ok(
      near({ actual: seriesInductance, expected: inductance }),
      `${label}: series L`,
    )
    assert.ok(
      near({ actual: seriesResistance, expected: resistance }),
      `${label}: DC R`,
    )
    const groundShunts = shunts.filter((entry) => entry[2] === "0")
    const groundCapacitance = groundShunts.reduce(
      (sum, entry) => sum + Number(entry[3]),
      0,
    )
    assert.ok(
      near({ actual: groundCapacitance, expected: ground }),
      `${label}: C to ground`,
    )
    if (size > 1) {
      const pair = Math.abs(line.C[0][1]) * metres
      const pairShunts = shunts.filter((entry) => entry[2] !== "0")
      const pairCapacitance = pairShunts.reduce(
        (sum, entry) => sum + Number(entry[3]),
        0,
      )
      assert.ok(
        near({ actual: pairCapacitance, expected: pair }),
        `${label}: pair C`,
      )
      const expected = line.L[0][1] / Math.sqrt(line.L[0][0] * line.L[1][1])
      const couplingElements = ladder.lines.filter((entry) =>
        entry.startsWith("KARCL"),
      )
      const couplings = couplingElements.map((entry) =>
        Number(entry.split(" ")[3]),
      )
      const validCoupling = couplings.every(
        (k) =>
          Math.abs(k / expected - 1) <= ELEMENT_TOLERANCE && Math.abs(k) < 1,
      )
      assert.ok(
        couplings.length === ladder.cells / 2 && validCoupling,
        `${label}: K`,
      )
    }
    const cellDelayPs = (ladder.maximumDelaySeconds * 1e12).toFixed(3)
    console.log(
      `${label}: ${ladder.cells} cells, maximum cell delay ${cellDelayPs} ps`,
    )
  }
})

/** Permit 1% relative timing error from ladder dispersion. */
const TRANSIENT_TIMING_TOLERANCE = 0.01
/** Permit 10 mV of reflection ripple on the matched half-volt signal. */
const MATCHED_RIPPLE_TOLERANCE_VOLTS = 0.01
/** Compare open-end plateaus to within 2% of the 1 V swing. */
const OPEN_PLATEAU_TOLERANCE_VOLTS = 0.02
/** Check four visible plateaus at each end of the open line. */
const OPEN_LINE_PLATEAUS = 4

/** The source edge is settled 200 ps after launch. */
const SOURCE_SETTLED_SECONDS = 2e-10
/** Allow 300 ps after the modal round trip before the transient ends. */
const MODAL_SETTLED_SECONDS = 3e-10
/** Absolute voltage tolerance for the linear DC solution. */
const DC_VOLTAGE_TOLERANCE = 1e-5
/** Number of reflections summed for the infinite lattice approximation. */
const LATTICE_BOUNCES = 64

const skipNativeTests =
  process.env.SI_NATIVE_TESTS !== "1" || !ngspiceAvailable()

/** Resistive termination or source connection in a golden transient deck. */
interface DeckConnection {
  node: string
  resistance: number
}

/** Ramp source voltage and series resistance. */
interface DeckSource extends DeckConnection {
  sign: number
}

/** Stimulus, loads and saved vectors for one golden transient. */
interface TransientDeckOptions {
  title: string
  sources: DeckSource[]
  loads: DeckConnection[]
  stopSeconds: number
  probes: string[]
}

/** One small transient deck with ramp sources, the ladder and resistive loads. */
function transientDeck({
  ladder,
  title,
  sources,
  loads,
  stopSeconds,
  probes,
}: TransientDeckOptions & {
  ladder: RouteLadder
}): string {
  const sourceLines = sources.flatMap((source, i) => [
    `VS${i} src${i} 0 PWL(0 0 50p 0 150p ${source.sign})`,
    `RS${i} src${i} ${source.node} ${source.resistance}`,
  ])
  const loadLines = loads.map(
    (load, i) => `RL${i} ${load.node} 0 ${load.resistance}`,
  )
  const vectors = probes.map((node) => `v(${node})`).join(" ")
  const lines = [
    `* ${title}`,
    ".options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0.1",
    ...sourceLines,
    ...ladder.lines,
    ...loadLines,
    ".control",
    "set wr_singlescale",
    "set wr_vecnames",
    "set numdgt=12",
    `tran 1p ${stopSeconds} 0 1p`,
    `wrdata golden.dat ${vectors}`,
    "quit",
    ".endc",
    ".end",
  ]
  return `${lines.join("\n")}\n`
}

// Homogeneous stripline: T = l sqrt(er)/c exactly. Source and load equal the extracted Z0 = sqrt(L/C), so the
// reflection coefficient is zero (Pozar, Microwave Engineering, section 2.3). Declared tolerances: delay (far 50% minus
// near 50% of the 0.5 V incident step) within 1% of T, since ladder dispersion at 10 cells per rise is ~0.2%; both
// ends within 2% of the 0.5 V incident level from the end of the edge to 3T. One shared ngspice run.
/** Samples and independent predictions from the shared matched-line run. */
interface MatchedLine {
  rows: GoldenRows
  delay: number
  z: number
  cells: number
}

let matched: Promise<MatchedLine> | undefined
/** Run the matched-line deck once for both matched-line checks. */
function matchedRun(): Promise<MatchedLine> {
  matched ??= runMatchedLine()
  return matched
}

/** Build and run a matched stripline with resistive ends. */
async function runMatchedLine(): Promise<MatchedLine> {
  const { line, ladder } = straightLine({ section: stripline, lossScale: 1e-3 })
  const z = Math.sqrt(line.L[0][0] / line.C[0][0])
  const delay = ((lengthMm / 1000) * 2) / lightSpeed
  const rows = await runGoldenDeck(
    transientDeck({
      ladder,
      title: "matched",
      sources: [{ node: "near0", resistance: z, sign: 1 }],
      loads: [{ node: "far0", resistance: z }],
      stopSeconds: 3 * delay + SOURCE_SETTLED_SECONDS,
      probes: ["near0", "far0"],
    }),
  )
  return {
    rows,
    delay,
    z,
    cells: ladder.cells,
  }
}

const matchedNear =
  "golden stage 6: matched line delay is l sqrt(er)/c and the near end sees no reflection"
test.skipIf(skipNativeTests)(matchedNear, async () => {
  const { rows, delay, z, cells } = await matchedRun()
  const measured =
    crossingTime({ rows, column: 2, level: 0.25 }) -
    crossingTime({ rows, column: 1, level: 0.25 })
  const nearSettled = rows.filter(
    (row) => row[0] >= SOURCE_SETTLED_SECONDS && row[0] <= 3 * delay,
  )
  const nearRipple = Math.max(
    ...nearSettled.map((row) => Math.abs(row[1] - 0.5)),
  )
  console.log(
    JSON.stringify({
      z0: z,
      cells,
      expectedDelayPs: delay * 1e12,
      measuredDelayPs: measured * 1e12,
      delayError: measured / delay - 1,
      nearRippleV: nearRipple,
    }),
  )
  assert.ok(
    Math.abs(measured / delay - 1) <= TRANSIENT_TIMING_TOLERANCE,
    `delay ${measured} vs ${delay}`,
  )
  assert.ok(
    nearRipple <= MATCHED_RIPPLE_TOLERANCE_VOLTS,
    `near-end reflection ripple ${nearRipple} V`,
  )
})

const matchedFar =
  "golden stage 6: matched line far end stays at the incident level after the edge"
test.skipIf(skipNativeTests)(matchedFar, async () => {
  const { rows, delay } = await matchedRun()
  const farSettled = rows.filter(
    (row) => row[0] >= delay + SOURCE_SETTLED_SECONDS && row[0] <= 3 * delay,
  )
  const farRipple = Math.max(...farSettled.map((row) => Math.abs(row[2] - 0.5)))
  console.log(JSON.stringify({ farRippleV: farRipple }))
  assert.ok(
    farRipple <= MATCHED_RIPPLE_TOLERANCE_VOLTS,
    `far-end ripple ${farRipple} V`,
  )
})

/** Propagation and reflection data for the requested end of the line. */
interface LatticeOptions {
  timeSeconds: number
  delay: number
  incident: number
  source: number
  load: number
  end: "near" | "far"
}

/** Bounce-diagram (lattice) voltage at one end, t seconds after launch, for an ideal unit-time-delay step. */
function lattice({
  timeSeconds,
  delay,
  incident,
  source,
  load,
  end,
}: LatticeOptions): number {
  let value = 0
  if (end === "near") value = incident
  for (let k = 0; k < LATTICE_BOUNCES; k++) {
    const wave = incident * (source * load) ** k
    if (end === "far" && (2 * k + 1) * delay < timeSeconds)
      value += wave * (1 + load)
    if (end === "near" && (2 * k + 2) * delay < timeSeconds)
      value += wave * load * (1 + source)
  }
  return value
}

const openEndBounces =
  "golden stage 6: open end doubles the wave and bounces follow the lattice diagram"
test.skipIf(skipNativeTests)(openEndBounces, async () => {
  // Rs = Z0/3 gives Gamma_S = -1/2; the open end gives Gamma_L = +1 (1 Gohm). Lattice diagram (Bergeron; Johnson &
  // Graham, High-Speed Digital Design, section 4.3): far-end steps at (2k+1)T, near-end steps at 2kT, plateaus from the
  // summed reflections, first far plateau = 2 x incident. Tolerances: every plateau (k = 0..3, sampled mid-plateau)
  // within 2% of the 1 V source swing; every step's mid-level crossing within 1% of its ideal time after launch.
  const { line, ladder } = straightLine({ section: stripline, lossScale: 1e-3 })
  const z = Math.sqrt(line.L[0][0] / line.C[0][0])
  const delay = ((lengthMm / 1000) * 2) / lightSpeed
  const incident = z / (z / 3 + z)
  const source = (z / 3 - z) / (z / 3 + z)
  const load = (1e9 - z) / (1e9 + z)
  const rows = await runGoldenDeck(
    transientDeck({
      ladder,
      title: "open",
      sources: [{ node: "near0", resistance: z / 3, sign: 1 }],
      loads: [{ node: "far0", resistance: 1e9 }],
      stopSeconds: 8.5 * delay,
      probes: ["near0", "far0"],
    }),
  )
  const launch = crossingTime({ rows, column: 1, level: incident / 2 })
  const failures: string[] = []
  const records: Record<string, number | string>[] = []
  for (const [end, column, first] of [
    ["far", 2, 1],
    ["near", 1, 0],
  ] as const) {
    for (let k = 0; k < OPEN_LINE_PLATEAUS; k++) {
      const middle = (first + 2 * k + 1) * delay
      const reflections = {
        delay,
        incident,
        source,
        load,
        end,
      }
      const expected = lattice({ ...reflections, timeSeconds: middle })
      const value = valueAt({ rows, column, timeSeconds: launch + middle })
      if (!(Math.abs(value - expected) <= OPEN_PLATEAU_TOLERANCE_VOLTS)) {
        failures.push(`${end} plateau ${k}: ${value} vs ${expected}`)
      }
      const step = (first + 2 * k) * delay
      if (step > 0) {
        const level =
          (lattice({ ...reflections, timeSeconds: step - delay / 2 }) +
            expected) /
          2
        const crossing =
          crossingTime({
            rows,
            column,
            level,
            afterSeconds: launch + step - delay / 2,
          }) - launch
        if (!(Math.abs(crossing / step - 1) <= TRANSIENT_TIMING_TOLERANCE)) {
          failures.push(`${end} step ${k} at ${crossing} vs ${step}`)
        }
        records.push({
          end,
          k,
          plateauV: value,
          expectedV: expected,
          stepPs: crossing * 1e12,
          expectedStepPs: step * 1e12,
        })
      }
    }
  }
  console.log(JSON.stringify(records))
  assert.deepEqual(failures, [])
})

const evenAndOddModes =
  "golden stage 6: symmetric coupled pair carries even and odd modes at their own L/C velocities"
test.skipIf(skipNativeTests)(evenAndOddModes, async () => {
  // Symmetric pair: even mode L_e = L11 + L12, C_e = C11 + C12; odd mode with the minus sign; T_m = l sqrt(L_m C_m),
  // Z_m = sqrt(L_m/C_m) (Paul, MTL 2nd ed., section 5.2). Pure modal drive with modal terminations launches only that
  // mode. Tolerance: each modal delay (far minus near 50% crossings) within 1% of its prediction.
  const { line, ladder } = straightLine({
    section: microstripPair,
    lossScale: 1e-3,
  })
  const failures: string[] = []
  const records: Record<string, number>[] = []
  for (const sign of [1, -1]) {
    const L = line.L[0][0] + sign * line.L[0][1]
    const C = line.C[0][0] + sign * line.C[0][1]
    const z = Math.sqrt(L / C)
    const delay = (lengthMm / 1000) * Math.sqrt(L * C)
    let mode = "odd"
    if (sign > 0) mode = "even"
    const rows = await runGoldenDeck(
      transientDeck({
        ladder,
        title: mode,
        sources: [
          { node: "near0", resistance: z, sign: 1 },
          { node: "near1", resistance: z, sign },
        ],
        loads: [
          { node: "far0", resistance: z },
          { node: "far1", resistance: z },
        ],
        stopSeconds: 2 * delay + MODAL_SETTLED_SECONDS,
        probes: ["near0", "far0"],
      }),
    )
    const measured =
      crossingTime({ rows, column: 2, level: 0.25 }) -
      crossingTime({ rows, column: 1, level: 0.25 })
    records.push({
      mode: sign,
      z,
      expectedDelayPs: delay * 1e12,
      measuredDelayPs: measured * 1e12,
      error: measured / delay - 1,
    })
    if (!(Math.abs(measured / delay - 1) <= TRANSIENT_TIMING_TOLERANCE)) {
      failures.push(`${mode}: ${measured} vs ${delay}`)
    }
  }
  console.log(JSON.stringify(records))
  assert.deepEqual(failures, [])
})

const settledDivider =
  "golden stage 6: settled voltage equals the DC divider including the line resistance"
test.skipIf(skipNativeTests)(settledDivider, async () => {
  // At DC every Foster inductor shorts its resistor and every dielectric branch is open, so the line is R_dc l in
  // series: V_far = Vs RL/(Rs + R l + RL), V_near = Vs (R l + RL)/(Rs + R l + RL), with R = 1/(sigma w t) from the
  // geometry, not from the solver. Evaluated with ngspice .op, the t -> infinity state: the slowest Foster pole
  // (10 kHz) needs ~16 us of transient. Tolerance 1e-5 V: a linear DC solve is exact to gmin (1e-12 S) effects.
  const section: CrossSection = {
    conductors: [
      {
        id: "s",
        xMm: 0,
        zMm: 0.491,
        widthMm: 0.1,
        thicknessMm: 0.018,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: 1 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 1,
        er: 4,
        lossTangent: 0.02,
      },
    ],
  }
  const { ladder } = straightLine({ section, lossScale: 1 })
  const resistance = lengthMm / 1000 / (5.8e7 * 0.1e-3 * 0.018e-3)
  const lines = [
    "* dc divider",
    "VS0 src0 0 DC 1",
    "RS0 src0 near0 25",
    ...ladder.lines,
    "RL0 far0 0 25",
    ".control",
    "set wr_singlescale",
    "set wr_vecnames",
    "set numdgt=12",
    "op",
    "wrdata golden.dat v(near0) v(far0)",
    "quit",
    ".endc",
    ".end",
  ]
  const deck = `${lines.join("\n")}\n`
  const [row] = await runGoldenDeck(deck)
  const near = row.at(-2)!
  const far = row.at(-1)!
  const expectedNear = (resistance + 25) / (50 + resistance)
  const expectedFar = 25 / (50 + resistance)
  console.log(
    JSON.stringify({
      lineResistance: resistance,
      near,
      expectedNear,
      far,
      expectedFar,
    }),
  )
  const nearError = Math.abs(near - expectedNear)
  const farError = Math.abs(far - expectedFar)
  assert.ok(
    nearError <= DC_VOLTAGE_TOLERANCE && farError <= DC_VOLTAGE_TOLERANCE,
    `near ${near} vs ${expectedNear}, far ${far} vs ${expectedFar}`,
  )
})

// ---- Conductor-loss checks 28–29: the emitted ladder against an independent filament solve.
/** Real and imaginary parts of a complex number. */
type Complex = [real: number, imaginary: number]
/** Square complex matrix for the one- and two-mode attenuation reference. */
type ComplexMatrix = Complex[][]
/** Complex product. */
const times = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
]
/** Principal complex square root (Re >= 0). */
function root(a: Complex): Complex {
  const modulus = Math.hypot(a[0], a[1])
  const real = Math.sqrt((modulus + a[0]) / 2)
  if (real > 0) return [real, a[1] / (2 * real)]
  return [real, Math.sqrt((modulus - a[0]) / 2)]
}
/** Eigenvalues of a 1 x 1 or 2 x 2 complex matrix. */
function eigenvalues(m: ComplexMatrix): Complex[] {
  if (m.length === 1) return [m[0][0]]
  const trace: Complex = [m[0][0][0] + m[1][1][0], m[0][0][1] + m[1][1][1]]
  const product = times(m[0][0], m[1][1])
  const cross = times(m[0][1], m[1][0])
  const half: Complex = [trace[0] / 2, trace[1] / 2]
  const square = times(half, half)
  const discriminant = root([
    square[0] - product[0] + cross[0],
    square[1] - product[1] + cross[1],
  ])
  return [
    [half[0] + discriminant[0], half[1] + discriminant[1]],
    [half[0] - discriminant[0], half[1] - discriminant[1]],
  ]
}
/** Inverse of a 1 x 1 or 2 x 2 complex matrix. */
function inverse(m: ComplexMatrix): ComplexMatrix {
  let determinant = m[0][0]
  if (m.length !== 1) {
    const a = times(m[0][0], m[1][1])
    const b = times(m[0][1], m[1][0])
    determinant = [a[0] - b[0], a[1] - b[1]]
  }
  const scale = determinant[0] ** 2 + determinant[1] ** 2
  const reciprocal: Complex = [determinant[0] / scale, -determinant[1] / scale]
  if (m.length === 1) return [[reciprocal]]
  return [
    [times(m[1][1], reciprocal), times(minus(m[0][1]), reciprocal)],
    [times(minus(m[1][0]), reciprocal), times(m[0][0], reciprocal)],
  ]
}
/** Negated complex number. */
const minus = (a: Complex): Complex => [-a[0], -a[1]]

/** Complex matrix product. */
function product({
  a,
  b,
}: {
  a: ComplexMatrix
  b: ComplexMatrix
}): ComplexMatrix {
  return a.map((row) =>
    b[0].map((_, j) =>
      row.reduce<Complex>(
        (sum, value, k) => {
          const term = times(value, b[k][j])
          return [sum[0] + term[0], sum[1] + term[1]]
        },
        [0, 0],
      ),
    ),
  )
}

/** Coarser filament mesh for attenuation sweeps. */
const ATTENUATION_MESH = {
  x: 32,
  z: 16,
  xRatio: 1.25,
  zRatio: 1.35,
}

/** Port voltage stored in a wrdata row as consecutive real and imaginary values. */
function portVoltage({
  row,
  index,
}: {
  row: number[]
  index: number
}): Complex {
  const real = 1 + 2 * index
  return [row[real], row[real + 1]]
}

/** Ladder and independent attenuation estimates at one frequency and mode. */
interface ModalAttenuationPoint {
  frequency: number
  mode: number
  ladder: number
  reference: number
}

/**
 * Modal attenuation of 100 mm of `section` from ngspice AC on the emitted ladder, against the filament reference.
 * Each run drives one near end with 1 A, every far end open. For a chain of identical symmetric cells the A-parameter
 * matrix V_near V_far^-1 = cosh(Gamma l), so the modal alpha l are Re acosh of its eigenvalues. Reference modes:
 * gamma^2 = eigenvalues of (R + j w L)(j w C), R and L from filamentImpedance, C from the field solver (checks 2–6).
 * Modes are paired by ascending alpha. Lossless dielectric, so only conductor loss remains.
 */
async function modalAttenuation({
  section,
  planeThicknessM,
}: {
  section: CrossSection
  planeThicknessM: number
}): Promise<ModalAttenuationPoint[]> {
  const { line, ladder } = straightLine({ section, lossScale: 1 })
  const ports = section.conductors.map((_, i) => i)
  const runs: GoldenRows[] = []
  for (const port of ports) {
    const nearProbes = ports.map((i) => `v(near${i})`).join(" ")
    const farProbes = ports.map((i) => `v(far${i})`).join(" ")
    const lines = [
      "* conductor loss",
      ".options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0.1",
      `I0 0 near${port} DC 0 AC 1`,
      ...ports.flatMap((i) => [
        `RN${i} near${i} 0 1e12`,
        `RF${i} far${i} 0 1e12`,
      ]),
      ...ladder.lines,
      ".control",
      "set wr_singlescale",
      "set wr_vecnames",
      "set numdgt=12",
      "ac dec 3 1e7 5e9",
      `wrdata golden.dat ${nearProbes} ${farProbes}`,
      "quit",
      ".endc",
      ".end",
    ]
    runs.push(await runGoldenDeck(`${lines.join("\n")}\n`))
  }
  const frequencies = runs[0].map((row) => row[0])
  const reference = filamentImpedance({
    line: {
      strips: section.conductors.map((c) => ({
        xM: c.xMm * 1e-3,
        widthM: c.widthMm * 1e-3,
        thicknessM: c.thicknessMm * 1e-3,
        bottomM: c.zMm * 1e-3,
      })),
      spacingM: section.planes[1].zMm * 1e-3,
      planeThicknessM,
      conductivity: 5.8e7,
    },
    frequencies,
    cells: ATTENUATION_MESH,
  })
  const metres = lengthMm / 1000
  return frequencies.flatMap((frequency, k) => {
    const responses = runs.map((rows) => rows[k])
    const near = ports.map((i) =>
      ports.map((port) => portVoltage({ row: responses[port], index: i })),
    )
    const far = ports.map((i) =>
      ports.map((port) =>
        portVoltage({ row: responses[port], index: ports.length + i }),
      ),
    )
    const ladderAlpha = eigenvalues(product({ a: near, b: inverse(far) }))
      .map((value) => {
        // acosh(w) = ln(w + sqrt(w^2 - 1)), taking the root with |.| >= 1.
        const square = times(value, value)
        const s = root([square[0] - 1, square[1]])
        const plus = Math.hypot(value[0] + s[0], value[1] + s[1])
        const minus = Math.hypot(value[0] - s[0], value[1] - s[1])
        return Math.log(Math.max(plus, minus)) / metres
      })
      .sort((a, b) => a - b)
    const omega = 2 * Math.PI * frequency
    const impedance = reference[k].R.map((row, i) =>
      row.map((r, j) => [r, omega * reference[k].L[i][j]] as Complex),
    )
    const admittance = line.C.map((row) =>
      row.map((c) => [0, omega * c] as Complex),
    )
    const referenceModes = eigenvalues(product({ a: impedance, b: admittance }))
    const referenceAlpha = referenceModes
      .map((value) => root(value)[0])
      .sort((a, b) => a - b)
    return ladderAlpha.map((alpha, mode) => ({
      frequency,
      mode,
      ladder: alpha,
      reference: referenceAlpha[mode],
    }))
  })
}

// Tolerance for checks 28–29, banded like check 27: 10% up to 50 MHz, 5% from 100 MHz. Modal alpha follows R at most
// one to one; ladder dispersion at 10 cells per 100 ps rise is ~0.4% at 5 GHz; the coarser 32 x 16 reference mesh used
// here moves R by < 1% at 5 GHz against 48 x 20.
/** Diagnostic rows and failures of the attenuation comparison. */
interface AttenuationComparison {
  records: Record<string, number | string>[]
  failures: string[]
}

/** Convert nepers to decibels for the attenuation report. */
const DECIBELS_PER_NEPER = 8.685889638

/** Records and failures of one modal comparison under the banded tolerance. */
function banded({
  label,
  results,
}: {
  label: string
  results: ModalAttenuationPoint[]
}): AttenuationComparison {
  const records = results.map(({ frequency, mode, ladder, reference }) => ({
    line: label,
    mode,
    frequencyHz: +frequency.toPrecision(4),
    referenceDbPerM: +(DECIBELS_PER_NEPER * reference).toFixed(4),
    ladderDbPerM: +(DECIBELS_PER_NEPER * ladder).toFixed(4),
    errorPercent: +(100 * (ladder / reference - 1)).toFixed(2),
  }))
  const outOfBand = results.filter(
    ({ frequency, ladder, reference }) =>
      !(Math.abs(ladder / reference - 1) <= conductorLossTolerance(frequency)),
  )
  const failures = outOfBand.map(
    ({ frequency, mode, ladder, reference }) =>
      `${label} mode ${mode} at ${frequency} Hz: ${ladder} vs ${reference} Np/m`,
  )
  return { records, failures }
}

const ladderAttenuation = `golden stage 6: ladder attenuation follows a filament conductor-loss reference from 10 ${"MHz to 5 GHz"}`
test.skipIf(skipNativeTests)(ladderAttenuation, async () => {
  // One uncoupled trace: the DDR3 board's inner trace, 0.1 x 0.0152 mm centred in b = 0.2152 mm, er 4.1, planes
  // 15.2 um.
  const section: CrossSection = {
    conductors: [
      {
        id: "s",
        xMm: 0,
        zMm: 0.1,
        widthMm: 0.1,
        thicknessMm: 0.0152,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: 0.2152 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 0.2152,
        er: 4.1,
        lossTangent: 0,
      },
    ],
  }
  const { records, failures } = banded({
    label: "0.1 x 0.0152 mm",
    results: await modalAttenuation({ section, planeThicknessM: 0.0152e-3 }),
  })
  console.log(JSON.stringify(records))
  console.table(records)
  assert.deepEqual(failures, [])
})

/** Strip centre, width and thickness in millimetres. */
type PairStrip = [xMm: number, widthMm: number, thicknessMm: number]

/** Modal comparison of one coupled pair centred in b = 0.2152 mm, er 4.1, planes 15.2 um. */
async function pairAttenuation({
  label,
  conductors,
}: {
  label: string
  conductors: PairStrip[]
}): Promise<AttenuationComparison> {
  const section: CrossSection = {
    conductors: conductors.map(([x, w, t], i) => ({
      id: `c${i}`,
      xMm: x,
      zMm: (0.2152 - t) / 2,
      widthMm: w,
      thicknessMm: t,
    })),
    planes: [{ zMm: 0 }, { zMm: 0.2152 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 0.2152,
        er: 4.1,
        lossTangent: 0,
      },
    ],
  }
  return banded({
    label,
    results: await modalAttenuation({ section, planeThicknessM: 0.0152e-3 }),
  })
}

// Check 29 exercises the coupled skin multiport (55% of the DDR3 addr/cmd cells): even and odd modes of a symmetric
// pair, then the two modes of a mixed pair whose rows have different DC-to-skin crossovers.
const coupledAttenuation = `golden stage 6: coupled-pair modal attenuation follows a 2 x 2 filament reference from 10 ${"MHz to 5 GHz"}`
test.skipIf(skipNativeTests)(coupledAttenuation, async () => {
  // Two 0.1 x 0.0152 mm traces with a 0.1 mm gap.
  const { records, failures } = await pairAttenuation({
    label: "symmetric 0.1/0.1",
    conductors: [
      [-0.1, 0.1, 0.0152],
      [0.1, 0.1, 0.0152],
    ],
  })
  console.log(JSON.stringify(records))
  console.table(records)
  assert.deepEqual(failures, [])
})

// Known failure: mode 0 is off by -10.7% at 10 MHz (the model planes are half-spaces).
// Every other point is within the band.
const mixedAttenuation =
  "golden stage 6: mixed-thickness pair modal attenuation follows a 2 x 2 filament reference"
const mixedAttenuationTest = skipNativeTests ? test.skip : test.failing
mixedAttenuationTest(mixedAttenuation, async () => {
  // 0.1 x 0.0152 mm beside 0.2 x 0.035 mm, 0.1 mm gap.
  const { records, failures } = await pairAttenuation({
    label: "mixed 0.1@15.2um / 0.2@35um",
    conductors: [
      [-0.1, 0.1, 0.0152],
      [0.15, 0.2, 0.035],
    ],
  })
  console.log(JSON.stringify(records))
  console.table(records)
  assert.deepEqual(failures, [])
})
