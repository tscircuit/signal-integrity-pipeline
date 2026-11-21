import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type PackageModel,
  parsePackageModel,
} from "../../src/buffers/package-model"

/** Rewrite fixture keywords in the uppercase, underscore-separated spelling. */
function underscoreKeywords(source: string): string {
  let text = ""
  let start = 0
  while (start < source.length) {
    const open = source.indexOf("[", start)
    if (open < 0) break
    const close = source.indexOf("]", open + 1)
    if (close < 0) break
    const key = source
      .slice(open + 1, close)
      .replaceAll(" ", "_")
      .toUpperCase()
    text += `${source.slice(start, open + 1)}${key}]`
    start = close + 1
  }
  return `${text}${source.slice(start)}`
}

/** Small original fixture; numeric-looking names still follow the declared pin order. */
function fixture({
  data,
  pins = ["Z9", "A1", "7"],
}: {
  data: string
  pins?: PackageModel["pins"]
}): string {
  return `[Define Package Model] Example package
[Manufacturer] Example Semiconductor
[OEM] Example Packaging
[Description] Original three-pin fixture
[Number Of Pins] ${pins.length}
[Pin Numbers]
${pins.join("\n")}
[Model Data]
${data}
[End Model Data]
[End Package Model]`
}

const full = "[Row] Z9\n4nH 1n\n-0.5n\n[Row] A1\n3n 0.2n\n[Row] 7\n2n"
const sparse =
  "[Row] Z9\n7 -0.5n\nZ9 4n\nA1 1n\n[Row] A1\n7 0.2n\nA1 3n\n[Row] 7\n7 2n"
const resistance =
  "[Resistance Matrix] Banded_matrix\n[Bandwidth] 0\n[Row] Z9\n1m\n[Row] A1\n2m\n[Row] 7\n3m"
const inductance = `[Inductance Matrix] Sparse_matrix\n${sparse}`
const capacitance = `[Capacitance Matrix] Full_matrix\n${full}`
const valid = fixture({
  data: [resistance, inductance, capacitance].join("\n"),
})

test("reads upper triangles in pin order", () => {
  const formats = [
    ["Full_matrix", full],
    ["Sparse_matrix", sparse],
    ["Banded_matrix", `[Bandwidth] 2\n${full}`],
  ]
  for (const [format, rows] of formats) {
    const data = `[Inductance Matrix] ${format}\n${rows}\n[Capacitance Matrix] ${format}\n${rows}`
    const parsed = parsePackageModel({
      text: fixture({ data }),
      name: "Example package",
    })
    assert.deepEqual(parsed.pins, ["Z9", "A1", "7"])
    const expected = [
      [4e-9, 1e-9, -5e-10],
      [1e-9, 3e-9, 2e-10],
      [-5e-10, 2e-10, 2e-9],
    ]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        assert.ok(Math.abs(parsed.L[i][j] - expected[i][j]) < 1e-24)
      }
    }
    assert.deepEqual(
      parsed.R,
      Array.from({ length: 3 }, () => [0, 0, 0]),
      "absent resistance is zero by spec",
    )
    assert.equal(parsed.manufacturer, "Example Semiconductor")
  }
})

test("reads truncated and circular bands", () => {
  const band = "[Bandwidth] 1\n[Row] Z9\n4n 1n\n[Row] A1\n3n .2n\n[Row] 7\n2n"
  const ring = `${band} -.5n`
  for (const [rows, corner] of [
    [band, 0],
    [ring, -5e-10],
  ] as const) {
    const data = `[Inductance Matrix] Banded_matrix\n${rows}\n[Capacitance Matrix] Banded_matrix\n${rows}`
    const parsed = parsePackageModel({
      text: fixture({ data }),
      name: "Example package",
    })
    assert.equal(
      parsed.L[0][2],
      corner,
      "last row distinguishes truncated and wrap-around bands",
    )
  }
})

test("reads zero-bandwidth resistance", () => {
  assert.equal(
    parsePackageModel({ text: valid, name: "Example package" }).R[1][1],
    0.002,
  )
})

test("accepts underscore keywords", () => {
  const parsed = parsePackageModel({
    text: underscoreKeywords(valid),
    name: "Example package",
  })
  assert.deepEqual(parsed.pins, ["Z9", "A1", "7"])
})

test("applies custom comment markers", () => {
  const comment = valid.replace("7 -0.5n", "7 -0.5n # ignored column")
  const changedMarker = valid.replace(
    "[Model Data]",
    "[Comment Char] #_char\n[Model Data]",
  )
  const globalComment = parsePackageModel({
    text: `[Comment Char] #_char\n${comment}`,
    name: "Example package",
  })
  assert.deepEqual(globalComment.pins, ["Z9", "A1", "7"])
  const changedComment = parsePackageModel({
    text: `[Comment Char] |_char\n${changedMarker}`,
    name: "Example package",
  })
  assert.deepEqual(changedComment.pins, ["Z9", "A1", "7"])
})

test("requires OEM metadata", () => {
  const text = valid.replace("[OEM] Example Packaging\n", "")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /OEM/,
  )
})

test("requires the end of matrix data", () => {
  const text = valid.replace("[End Model Data]", "")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /End Model Data/,
  )
})

test("requires the end of a definition", () => {
  const text = valid.replace("[End Package Model]", "")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /End Package Model/,
  )
})

test("checks the declared pin count", () => {
  const text = valid.replace("[Number Of Pins] 3", "[Number Of Pins] 4")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /pin count/i,
  )
})

test("rejects distributed package sections", () => {
  const text = valid.replace(
    "[Pin Numbers]",
    "[Number Of Sections] 1\n[Pin Numbers]",
  )
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /sections.*unsupported/i,
  )
})

test("rejects section syntax in pin lists", () => {
  const text = valid.replace("Z9\nA1", "Z9 Len=0 L=1n/\nA1")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /section.*unsupported/i,
  )
})

test("rejects unknown sparse columns", () => {
  const text = valid.replace("7 -0.5n", "absent -0.5n")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /unknown.*column/i,
  )
})

test("rejects lower-triangle entries", () => {
  const text = valid.replace("7 0.2n", "Z9 0.2n")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /upper triangle/i,
  )
})

test("rejects nonnumeric coefficients", () => {
  const text = valid.replace("7 -0.5n", "7 NA")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /numeric/i,
  )
})

test("rejects infinite coefficients", () => {
  const text = valid.replace("7 -0.5n", "7 1e999")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /finite/i,
  )
})

test("rejects duplicate sparse columns", () => {
  const text = valid.replace("7 -0.5n", "7 -0.5n\n7 1n")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /duplicate/i,
  )
})

test("rejects out-of-range bandwidth", () => {
  const text = valid.replace("[Bandwidth] 0", "[Bandwidth] 3")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /bandwidth/i,
  )
})

test("requires bandwidth on banded matrices", () => {
  const text = valid.replace("[Bandwidth] 0\n", "")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /Bandwidth/,
  )
})

test("rejects truncated full rows", () => {
  const text = valid.replace("4nH 1n", "4nH")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /expected.*entries/,
  )
})

test("rejects bandwidth on full matrices", () => {
  const text = valid.replace(
    "[Capacitance Matrix] Full_matrix",
    "[Capacitance Matrix] Full_matrix\n[Bandwidth] 1",
  )
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /Bandwidth/,
  )
})

test("rejects data after the end marker", () => {
  const text = valid.replace("[End Package Model]", "[End Package Model] extra")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /unexpected data/,
  )
})

test("checks row order", () => {
  const text = valid.replace("[Row] A1\n3n", "[Row] Z9\n3n")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /row order/i,
  )
})

test("requires one sparse pair per line", () => {
  const text = valid.replace("7 -0.5n", "7 -0.5n A1 1n")
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /index.*value/i,
  )
})

test("rejects duplicate package definitions", () => {
  const text = valid + "\n" + valid
  assert.throws(
    () => parsePackageModel({ text, name: "Example package" }),
    /duplicate.*package/i,
  )
})

test("requires the selected definition", () => {
  assert.throws(
    () => parsePackageModel({ text: valid, name: "missing" }),
    /missing.*scalar fallback is forbidden/i,
  )
})

test("wraps circular bands by pin order", () => {
  const five = ["z", "a", "9", "b", "0"]
  const ringRows = five
    .map((pin, i) => `[Row] ${pin}\n${i + 10} ${i + 1} ${i + 2}`)
    .join("\n")
  const ringBand = `Banded_matrix\n[Bandwidth] 2\n${ringRows}`
  const ringData = `[Inductance Matrix] ${ringBand}\n[Capacitance Matrix] ${ringBand}`
  const ringModel = parsePackageModel({
    text: fixture({ data: ringData, pins: five }),
    name: "Example package",
  })
  assert.deepEqual(ringModel.L, [
    [10, 1, 2, 5, 5],
    [1, 11, 2, 3, 6],
    [2, 2, 12, 3, 4],
    [5, 3, 3, 13, 4],
    [5, 6, 4, 4, 14],
  ])
})
