import { spiceNumber } from "@tscircuit/ibis-to-spice"
import { isSpace, lineRanges, tokenEnd } from "./source-tokens"
import type { SwitchingCoefficientSamples } from "./switching-tail"

/** The directive and name from a generated SPICE subcircuit header. */
type GeneratedSubcircuitHeader = [directive: ".subckt", name: string]

/** Find the first generated subcircuit header with a name immediately after the directive. */
export function subcircuitHeader(
  source: string,
): GeneratedSubcircuitHeader | null {
  const directive = ".subckt"
  for (const { start, end } of lineRanges(source)) {
    if (
      source.slice(start, start + directive.length + 1).toLowerCase() !==
      `${directive} `
    )
      continue
    const nameStart = start + directive.length + 1
    if (nameStart >= end) continue
    const nameEnd = tokenEnd({ text: source, start: nameStart })
    if (nameEnd > nameStart)
      return [directive, source.slice(nameStart, nameEnd)]
  }
  return null
}
/** Read the two nodes of a generated PWL voltageSourceName line. */
function pwlNodes({
  line,
  voltageSourceName,
}: {
  line: string
  voltageSourceName: string
}): string | undefined {
  if (!line.startsWith(`${voltageSourceName} `) || !line.endsWith(")"))
    return undefined
  const first = voltageSourceName.length + 1
  const firstEnd = tokenEnd({ text: line, start: first })
  if (firstEnd === first || line[firstEnd] !== " ") return undefined
  const second = firstEnd + 1
  const secondEnd = tokenEnd({ text: line, start: second })
  if (secondEnd === second || !line.startsWith(" PWL(", secondEnd))
    return undefined
  return line.slice(first, secondEnd)
}

/** Replace the first matching generated source, retaining its nodes and line separator. */
export function replacePwl({
  source,
  voltageSourceName,
  samples,
  coefficientKind,
}: {
  source: string
  voltageSourceName: string
  samples: SwitchingCoefficientSamples
  coefficientKind: "pullup" | "pulldown"
}): string {
  for (const { start, end } of lineRanges(source)) {
    const nodes = pwlNodes({
      line: source.slice(start, end),
      voltageSourceName,
    })
    if (nodes === undefined) continue
    let column = 1
    if (coefficientKind === "pulldown") column = 2
    const points = samples
      .map((row) => `${spiceNumber(row[0])} ${spiceNumber(row[column])}`)
      .join(" ")
    return `${source.slice(0, start)}${voltageSourceName} ${nodes} PWL(${points})${source.slice(end)}`
  }
  throw new Error(
    `Missing generated IBIS switching source ${voltageSourceName}`,
  )
}

/** SPICE node name in the package subcircuit. */
export type SpiceNode = string

/** Remap whole SPICE tokens while preserving whitespace. */
function remapNodes({
  line,
  nodes,
}: {
  line: string
  nodes: ReadonlyMap<SpiceNode, SpiceNode>
}): string {
  let source = ""
  for (let start = 0; start < line.length; ) {
    if (isSpace(line[start])) {
      source += line[start]
      start++
      continue
    }
    const end = tokenEnd({ text: line, start })
    const token = line.slice(start, end)
    source += nodes.get(token) || token
    start = end
  }
  return source
}

/** Attach package elements and remap the die-buffer instances inside the wrapper. */
export function withPackageElements({
  source,
  nodes,
  elements,
}: {
  source: string
  nodes: ReadonlyMap<SpiceNode, SpiceNode>
  elements: string[]
}): string {
  const lines = source.split("\n")
  const wrapperStartIndex = lines.findIndex((line) =>
    line.toLowerCase().startsWith(".subckt "),
  )
  const wrapperEndIndex = lines.findIndex((line) =>
    line.toLowerCase().startsWith(".ends "),
  )
  if (wrapperStartIndex < 0 || wrapperEndIndex <= wrapperStartIndex)
    throw new Error("Missing IBIS wrapper subcircuit")
  const wrapper = lines.slice(wrapperStartIndex + 1, wrapperEndIndex)
  return [
    ...lines.slice(0, wrapperStartIndex + 1),
    ...wrapper.map((line) => remapNodes({ line, nodes })),
    ...elements,
    ...lines.slice(wrapperEndIndex),
  ].join("\n")
}
