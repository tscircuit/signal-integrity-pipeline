import {
  type IbisCorner,
  ibisNumber,
  parseIbis,
} from "@tscircuit/ibis-to-spice"

export const corners = ["typical", "minimum", "maximum"] as const
export const directions = ["Input", "Output", "I/O", "3-state"] as const

/** Read case-insensitive IBIS line tokens while excluding the comment. */
function tokens(line: string): string[] {
  return line
    .split("|")[0]
    .replaceAll("=", " ")
    .trim()
    .split(" ")
    .flatMap((part) => part.split("\t"))
    .filter(Boolean)
}

/** Split a bracketed keyword from its optional same-line fields. */
function header(line: string): string | undefined {
  const end = line.indexOf("]")
  if (line.startsWith("[") && end !== -1)
    return line.slice(1, end).toLowerCase()
}

/** Bounds of a single IBIS model within its source lines. */
type ModelSpan = [start: number, end: number]

/** Locate the selected model's declaration and its owned field/table blocks. */
function modelSpan({
  lines,
  name,
}: {
  lines: string[]
  name: string
}): ModelSpan {
  const start = lines.findIndex(
    (line) => header(line.trim()) === "model" && tokens(line).at(1) === name,
  )
  if (start === -1)
    throw new Error(`Embedded [Model] ${name} could not be located.`)
  const blocks = new Set([
    "model",
    "component",
    "model selector",
    "submodel",
    "end",
  ])
  const end = lines.findIndex(
    (line, index) => index > start && blocks.has(header(line.trim()) ?? ""),
  )
  return [start, end === -1 ? lines.length : end]
}

interface ModelEdit {
  name: string
  newName?: string
  corner?: IbisCorner
  direction?: string
  scale?: number
  driveRatio?: number
  capacitancePf?: number
}

const tableBlocks = new Set([
  "pullup",
  "pulldown",
  "power clamp",
  "gnd clamp",
  "ground clamp",
  "rising waveform",
  "falling waveform",
])
const rangeBlocks = new Set([
  "voltage range",
  "pullup reference",
  "pulldown reference",
  "power clamp reference",
  "gnd clamp reference",
  "ground clamp reference",
  "external reference",
])

/** Copy a chosen process corner into the typical column consumed by the pipeline. */
function cornerLine({
  line,
  index,
  section,
}: {
  line: string
  index: number
  section: string
}): string {
  const fields = tokens(line)
  const end = line.indexOf("]")
  const keyword = header(line.trim())
  if (keyword && rangeBlocks.has(keyword)) {
    const values = tokens(line.slice(end + 1))
    if (values[index] && values[index].toLowerCase() !== "na")
      values[0] = values[index]
    return `${line.slice(0, end + 1)} ${values.join(" ")}`
  }
  const field = fields[0]?.toLowerCase()
  if (
    field === "c_comp" ||
    field === "dv/dt_r" ||
    field === "dv/dt_f" ||
    (tableBlocks.has(section) && field && "+-.0123456789".includes(field[0]))
  ) {
    if (fields[index + 1] && fields[index + 1].toLowerCase() !== "na")
      fields[1] = fields[index + 1]
    return fields.join(" ")
  }
  return line
}

/** Rewrite only the intended model, optionally cloning it for one physical pin. */
export function editIbisText({
  source,
  edit,
}: {
  source: string
  edit: ModelEdit
}): string {
  const lines = source.split("\n")
  const [start, end] = modelSpan({ lines, name: edit.name })
  const document = parseIbis(source)
  if (edit.corner && edit.corner !== "typical") {
    const buffer = document.getBuffer(edit.name)
    const column = corners.indexOf(edit.corner)
    const required = [
      buffer.capacitance,
      buffer.voltage,
      buffer.pullupReference,
      buffer.pulldownReference,
      buffer.groundClampReference,
      buffer.powerClampReference,
      buffer.externalReference,
      buffer.ramp?.rising,
      buffer.ramp?.falling,
    ].filter((values) => values?.[0] != null)
    const tables = [
      buffer.pullup,
      buffer.pulldown,
      buffer.powerClamp,
      buffer.groundClamp,
    ].filter((table) => table !== undefined)
    if (
      required.some((values) => values?.[column] == null) ||
      tables.some((table) => table.some((row) => row[column + 1] == null)) ||
      buffer.waveforms.some((wave) =>
        wave.data.some((row) => row[column + 1] == null),
      )
    )
      throw new Error(
        `Model ${edit.name} is missing ${edit.corner} corner samples.`,
      )
  }
  if (
    edit.capacitancePf !== undefined &&
    (!Number.isFinite(edit.capacitancePf) || edit.capacitancePf < 0)
  )
    throw new Error("C_comp must be finite and nonnegative.")
  if (
    edit.scale !== undefined &&
    (!Number.isFinite(edit.scale) || edit.scale < 0.5 || edit.scale > 2)
  )
    throw new Error("Drive scale must be between 0.50× and 2.00×.")
  const model = lines.slice(start, end)
  const corner = corners.indexOf(edit.corner ?? "typical")
  let section = ""
  let changedCapacitance = false
  let fixtureIndex = -1
  for (const [index, raw] of model.entries()) {
    const line = raw.trim()
    const keyword = header(line)
    if (keyword) {
      section = keyword
      if (
        corner > 0 &&
        (keyword === "rising waveform" || keyword === "falling waveform")
      )
        fixtureIndex++
    }
    const fields = tokens(line)
    const first = fields[0]?.toLowerCase()
    if (corner > 0) {
      model[index] = cornerLine({ line: raw, index: corner, section })
      if (first === "v_fixture" && fixtureIndex >= 0) {
        const value = document.getBuffer(edit.name).waveforms[fixtureIndex]
          ?.fixtureVoltage[corner]
        if (value != null) model[index] = `V_fixture = ${value}`
      }
    }
    if (edit.direction && first === "model_type")
      model[index] = `Model_type ${edit.direction}`
    if (edit.capacitancePf !== undefined && first === "c_comp") {
      const value = `${edit.capacitancePf}p`
      model[index] = `C_comp ${value} ${value} ${value}`
      changedCapacitance = true
    }
    if (
      edit.scale !== undefined &&
      (section === "pullup" || section === "pulldown") &&
      first &&
      "+-.0123456789".includes(first[0])
    ) {
      const [voltage, ...values] = tokens(model[index])
      model[index] = [
        voltage,
        ...values.map((token) => {
          const current = ibisNumber(token)
          if (current === null) return token
          return String(current * (edit.driveRatio ?? edit.scale!))
        }),
      ].join(" ")
    }
  }
  if (edit.capacitancePf !== undefined && !changedCapacitance)
    throw new Error("The selected model has no C_comp table.")
  if (edit.newName) {
    model[0] = `[Model] ${edit.newName}`
    lines.splice(end, 0, ...model)
  } else {
    lines.splice(start, end - start, ...model)
  }
  const updated = lines.join("\n")
  parseIbis(updated).getBuffer(edit.newName ?? edit.name)
  return updated
}

/** Update the physical pin declaration so the converter validates the new assignment. */
export function bindIbisPin({
  source,
  component,
  pin,
  name,
}: {
  source: string
  component: string
  pin: string
  name: string
}): string {
  let matching = false
  let inPins = false
  const lines = source.split("\n")
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    const keyword = header(line)
    if (keyword === "component") matching = tokens(line)[1] === component
    if (keyword) inPins = keyword === "pin" && matching
    if (!inPins || keyword) continue
    const fields = tokens(line)
    if (fields[0] !== pin || fields.length < 3) continue
    fields[2] = name
    lines[index] = fields.join(" ")
    return lines.join("\n")
  }
  throw new Error(
    `Pin ${pin} was not found in embedded component ${component}.`,
  )
}

/** Restore one buffer definition without altering other models or physical pin mappings. */
export function restoreIbisText({
  source,
  baseline,
  name,
}: {
  source: string
  baseline: string
  name: string
}): string {
  const lines = source.split("\n")
  const original = baseline.split("\n")
  const [start, end] = modelSpan({ lines, name })
  const [from, to] = modelSpan({ lines: original, name })
  lines.splice(start, end - start, ...original.slice(from, to))
  return lines.join("\n")
}
