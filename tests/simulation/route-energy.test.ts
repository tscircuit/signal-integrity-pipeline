import { test } from "bun:test"
import assert from "node:assert/strict"
import { causalLossPoles } from "../../src/extraction"
import {
  RouteEnergy,
  seriesEnergy,
  shuntEnergy,
  skinEnergy,
} from "../../src/simulation/route-energy"

/** Assemble in reverse order to verify dense-compatible column ordering. */
function energy(values: number[][]): RouteEnergy {
  const result = new RouteEnergy({ size: values.length })
  for (let i = values.length - 1; i >= 0; i--) {
    for (let j = values.length - 1; j >= 0; j--) {
      result.add({ row: i, column: j, coefficient: values[i][j] })
    }
  }
  return result
}

/** Read the last field of a stamped SPICE element. */
function elementValue({
  lines,
  name,
}: {
  lines: string[]
  name: string
}): number {
  const line = lines.find((line) => line.startsWith(`${name} `))!
  return Number(line.split(" ").at(-1))
}

test("stamps self and signed mutual inductance", () => {
  const matrix = energy([
    [4e-9, 1e-9, 0],
    [1e-9, 9e-9, -3e-9],
    [0, -3e-9, 16e-9],
  ])
  const lines: string[] = []
  seriesEnergy({
    lines,
    tag: "T",
    before: ["a", "b", "c"],
    after: ["d", "e", "f"],
    matrix,
    kind: "L",
  })
  assert.deepEqual(lines, [
    "LT0 a d 4e-9",
    "LT1 b e 9e-9",
    "LT2 c f 1.6e-8",
    "KT0_1 LT0 LT1 0.166666666667",
    "KT1_2 LT1 LT2 -0.25",
  ])
})

test("stores and scales only nonzero coefficients", () => {
  const matrix = energy([
    [4e-9, 1e-9, 0],
    [1e-9, 9e-9, -3e-9],
    [0, -3e-9, 16e-9],
  ])
  assert.equal(
    matrix.rows.reduce((sum, row) => sum + row.size, 0),
    7,
  )
  assert.deepEqual(matrix.scaled(2).entries(0), [
    [0, 8e-9],
    [1, 2e-9],
  ])
})

test("normalized reciprocal resistance obeys V = R I down to tiny Foster voltages", () => {
  const matrix = [
    [4e-5, 1e-5, 0],
    [1e-5, 9e-5, -3e-5],
    [0, -3e-5, 16e-5],
  ]
  const currents = [2e-9, -1e-9, 3e-9]
  const voltages = matrix.map((row) =>
    row.reduce((sum, r, j) => sum + r * currents[j], 0),
  )
  const lines: string[] = []
  seriesEnergy({
    lines,
    tag: "T",
    before: ["a", "b", "c"],
    after: ["0", "0", "0"],
    matrix: energy(matrix),
    kind: "R",
  })
  // Independently evaluate every emitted R/G branch's KCL at the exact terminal solution.
  const nodes = new Map(["a", "b", "c"].map((node, i) => [node, voltages[i]]))
  nodes.set("0", 0)
  currents.forEach((current, i) =>
    nodes.set(`Tr${i}`, Math.sqrt(matrix[i][i]) * current),
  )
  const residual = new Map<string, number>()
  for (const line of lines) {
    const [name, a, b, c, d, gain] = line.split(" ")
    assert.match(
      name,
      /^[RG]/,
      "no sensor or series CCVS branch unknowns at near-zero Foster voltage",
    )
    let current: number
    if (name.startsWith("R")) {
      current = (nodes.get(a)! - nodes.get(b)!) / Number(c)
    } else {
      current = Number(gain) * (nodes.get(c)! - nodes.get(d)!)
    }
    residual.set(a, (residual.get(a) ?? 0) + current)
    residual.set(b, (residual.get(b) ?? 0) - current)
  }
  for (const [i, node] of ["a", "b", "c"].entries()) {
    assert.ok(Math.abs(residual.get(node)! / currents[i] - 1) < 1e-11)
    assert.ok(Math.abs(residual.get(`Tr${i}`)!) < 1e-22)
  }
})

test("stamps uncoupled resistors directly", () => {
  const diagonal: string[] = []
  seriesEnergy({
    lines: diagonal,
    tag: "D",
    before: ["a", "b"],
    after: ["c", "d"],
    matrix: energy([
      [1e-4, 0],
      [0, 2e-4],
    ]),
    kind: "R",
  })
  assert.deepEqual(diagonal, ["RD0 a c 0.0001", "RD1 b d 0.0002"])
})

test("normalizes the coupled skin multiport", () => {
  // No conductor-wall share: the whole S is the unshifted remainder multiport.
  const matrix = [
    [4e-6, 1e-6, 0],
    [1e-6, 9e-6, -3e-6],
    [0, -3e-6, 16e-6],
  ]
  const currents = [2e-3, -1e-3, 3e-3]
  const poles = causalLossPoles()
  const lines: string[] = []
  skinEnergy({
    lines,
    tag: "T",
    before: ["a", "b", "c"],
    stripStages: poles.map((_, p) =>
      ["a", "b", "c"].map((node) => `q${node}${p}`),
    ),
    stages: poles.map((_, p) => ["a", "b", "c"].map((node) => `${node}${p}`)),
    matrix: energy(matrix),
    poles,
    dc: [1, 1, 1],
    strip: [0, 0, 0],
  })
  assert.equal(
    lines.filter((line) =>
      line
        .split(" ")
        .slice(1, -1)
        .some(
          (token) =>
            token.length === 3 &&
            token[0] === "q" &&
            "abc".includes(token[1]) &&
            token[2] >= "0" &&
            token[2] <= "9",
        ),
    ).length,
    0,
    "no conductor-wall chain without a share",
  )
  assert.equal(
    lines.filter((line) => line.startsWith("K")).length,
    0,
    "no per-pole mutual inductance layers",
  )
  for (const frequency of [1e6, 1e9, 2e10]) {
    const omega = 2 * Math.PI * frequency
    // Complex numbers as [real, imaginary]; z_p = skin jw / (jw + rate).
    const stage = poles.map((pole) => {
      const denominator = pole.rate ** 2 + omega ** 2
      return [
        (pole.skin * omega ** 2) / denominator,
        (pole.skin * omega * pole.rate) / denominator,
      ]
    })
    const z = stage.reduce(([re, im], [a, b]) => [re + a, im + b], [0, 0])
    const nodes = new Map<string, number[]>([["0", [0, 0]]])
    for (const [i, node] of ["a", "b", "c"].entries()) {
      const voltage = matrix[i].reduce((sum, s, j) => sum + s * currents[j], 0)
      const x = Math.sqrt(matrix[i][i]) * currents[i]
      nodes.set(node, [z[0] * voltage, z[1] * voltage])
      nodes.set(`${node}8`, [0, 0])
      nodes.set(`TSx${i}`, [x, 0])
      nodes.set(`TSu${i}`, [z[0] * x, z[1] * x])
      let drop = [0, 0]
      for (let p = 0; p < 8; p++) {
        drop = [drop[0] + stage[p][0] * x, drop[1] + stage[p][1] * x]
        nodes.set(`TF${p}_${i}`, [z[0] * x - drop[0], z[1] * x - drop[1]])
      }
    }
    const residual = new Map<string, number[]>()
    for (const line of lines) {
      const [name, a, b, c, d, gain] = line.split(" ")
      const [vr, vi] = [
        nodes.get(a)![0] - nodes.get(b)![0],
        nodes.get(a)![1] - nodes.get(b)![1],
      ]
      let current: number[]
      if (name.startsWith("R")) {
        current = [vr / Number(c), vi / Number(c)]
      } else if (name.startsWith("L")) {
        current = [vi / (omega * Number(c)), -vr / (omega * Number(c))]
      } else {
        const scale = Number(gain)
        const controlReal = nodes.get(c)![0] - nodes.get(d)![0]
        const controlImaginary = nodes.get(c)![1] - nodes.get(d)![1]
        current = [scale * controlReal, scale * controlImaginary]
      }
      for (const [node, sign] of [
        [a, 1],
        [b, -1],
      ] as const) {
        const previous = residual.get(node) ?? [0, 0]
        residual.set(
          node,
          previous.map((value, k) => value + sign * current[k]),
        )
      }
    }
    for (const [node, value] of residual) {
      let index = -1
      if (node.length) index = "abc".indexOf(node[0])
      let expected = 0
      if (index !== -1 && node.length === 1) expected = currents[index]
      if (index !== -1 && node.length === 2 && node[1] === "8")
        expected = -currents[index]
      if (node !== "0")
        assert.ok(
          Math.hypot(value[0] - expected, value[1]) < 1e-12,
          `${frequency} Hz KCL at ${node}`,
        )
    }
  }
})

/** Two real poles isolate the shifted conductor-wall response in a small matrix. */
const toyPoles = [
  { rate: 10, skin: 2, dielectric: 0 },
  { rate: 100, skin: 3, dielectric: 0 },
]

test("separates shifted and unshifted skin chains", () => {
  const diagonal: string[] = []
  // Row b: conductor-wall share 1.5e-4 of S = 2e-4, R_dc chosen so its own crossover is 90 rad/s: a shifted chain
  // b -> g -> h with stages (rate 100, skin 2 * 10/100) and (190, 3 * 100/190), then the 0.5e-4 remainder h -> d -> f.
  const dc = 1.5e-4 * Math.sqrt(90 / Math.PI)
  assert.equal(
    skinEnergy({
      lines: diagonal,
      tag: "D",
      before: ["a", "b"],
      stripStages: [
        ["q", "g"],
        ["r", "h"],
      ],
      stages: [
        ["c", "d"],
        ["e", "f"],
      ],
      matrix: energy([
        [1e-4, 0],
        [0, 2e-4],
      ]),
      poles: toyPoles,
      dc: [1, dc],
      strip: [0, 1.5e-4],
    }),
    0,
  )
  assert.deepEqual(
    diagonal.map((line) => line.split(" ").slice(0, 3).join(" ")),
    [
      "RDQ01 b g",
      "LDQ01 b g",
      "RDQ11 g h",
      "LDQ11 g h",
      "RDS00 a c",
      "RDS01 h d",
      "LDP00 a c",
      "LDP01 h d",
      "RDS10 c e",
      "RDS11 d f",
      "LDP10 c e",
      "LDP11 d f",
    ],
  )
  const expectedCoefficients = [
    ["RDQ01", (1.5e-4 * 2 * 10) / 100],
    ["LDQ01", (1.5e-4 * 2 * 10) / 100 / 100],
    ["RDQ11", (1.5e-4 * 3 * 100) / 190],
    ["LDQ11", (1.5e-4 * 3 * 100) / 190 / 190],
    ["RDS01", 0.5e-4 * 2],
    ["LDP01", (0.5e-4 * 2) / 10],
    ["RDS11", 0.5e-4 * 3],
    ["LDP11", (0.5e-4 * 3) / 100],
    ["RDS00", 1e-4 * 2],
  ] as const
  for (const [name, expected] of expectedCoefficients) {
    const actual = elementValue({ lines: diagonal, name })
    assert.ok(
      Math.abs(actual / expected - 1) < 1e-9,
      `${name}: ${actual} vs ${expected}`,
    )
  }
})

test("caps conductor-wall loss to keep the remainder passive", () => {
  // A coupled pair caps each own share at S_ii - |S_ij| so the shared remainder stays diagonally dominant (passive).
  const capped: string[] = []
  assert.equal(
    skinEnergy({
      lines: capped,
      tag: "C",
      before: ["a", "b"],
      stripStages: [
        ["q", "g"],
        ["r", "h"],
      ],
      stages: [
        ["c", "d"],
        ["e", "f"],
      ],
      matrix: energy([
        [1e-4, 3e-5],
        [3e-5, 1e-4],
      ]),
      poles: toyPoles,
      dc: [1e-3, 1e-3],
      strip: [9e-5, 5e-5],
    }),
    1,
  )
  const scale = elementValue({ lines: capped, name: "GCSI0" })
  assert.ok(
    Math.abs(scale - 1 / Math.sqrt(3e-5)) < 1e-6,
    "row a keeps a 3e-5 remainder",
  )
  const mutual = elementValue({ lines: capped, name: "GCS0_1" })
  assert.ok(
    Math.abs(mutual - 3e-5 / Math.sqrt(3e-5 * 5e-5)) < 1e-9,
    "normalized mutual over the remainders",
  )
})

test("stamps Maxwell shunts in matrix order", () => {
  const lines: string[] = []
  shuntEnergy({
    lines,
    tag: "T",
    nodes: ["a", "b", "c"],
    matrix: energy([
      [4e-12, -1e-12, 0],
      [-1e-12, 5e-12, -2e-12],
      [0, -2e-12, 6e-12],
    ]),
  })
  assert.deepEqual(lines, [
    "CTS0 a 0 3e-12",
    "CTS1 b 0 2e-12",
    "CTS2 c 0 4e-12",
    "CTS3 a b 1e-12",
    "CTS4 b c 2e-12",
  ])
})

test("stamps a dielectric relaxation branch", () => {
  const loss: string[] = []
  shuntEnergy({
    lines: loss,
    tag: "T",
    nodes: ["a"],
    matrix: energy([[1e-12]]),
    rate: 1e9,
  })
  assert.deepEqual(loss, ["CTS0 a TS0c 1e-12", "RTS0 TS0c 0 1000"])
})

test("memory admission counts actual entries, including hybrid dense couplings, rather than cells", () => {
  const sparse = new RouteEnergy({ size: 2000 })
  for (let i = 0; i < 2000; i++)
    sparse.add({ row: i, column: i, coefficient: 1 })
  assert.equal(
    sparse.rows.reduce((sum, row) => sum + row.size, 0),
    2000,
  )
  const budget = { entries: 499999 }
  const bounded = new RouteEnergy({ size: 2, budget })
  bounded.add({ row: 0, column: 0, coefficient: 1 })
  bounded.add({ row: 0, column: 0, coefficient: 1 })
  assert.throws(
    () => bounded.add({ row: 0, column: 1, coefficient: 0.1 }),
    /sparse-memory limit/,
  )
})
