import { spiceSubcircuitName, spiceWords } from "./spice-header"

/** A name used to resolve a SPICE subcircuit definition. */
type SubcircuitName = string

const SUBCIRCUIT_END = ".ends"

/** Expand voltage-source branch names through a compiled IBIS library without storing all ladder states. */
export function branchSaves({
  source,
  instance,
  wrapper,
}: {
  source: string
  instance: string
  wrapper: string
}): string[] {
  const definitions = new Map<SubcircuitName, string[]>()
  let current: string[] = []
  for (const line of source.split("\n")) {
    const name = spiceSubcircuitName(line)
    if (name !== undefined) {
      current = []
      definitions.set(name.toLowerCase(), current)
      continue
    }
    if (line.slice(0, SUBCIRCUIT_END.length).toLowerCase() !== SUBCIRCUIT_END)
      current.push(line)
  }
  return [
    ...collectBranchSaves({
      name: wrapper,
      path: instance.toLowerCase(),
      ancestors: new Set(),
      definitions,
    }),
  ]
}

/** ngspice prefixes subcircuit voltage devices with v.<instance path>.<device name>. */
function* collectBranchSaves({
  name,
  path,
  ancestors,
  definitions,
}: {
  name: SubcircuitName
  path: string
  ancestors: ReadonlySet<SubcircuitName>
  definitions: ReadonlyMap<SubcircuitName, string[]>
}): Generator<string> {
  const key = name.toLowerCase()
  if (ancestors.has(key)) throw new Error(`Recursive SPICE subcircuit: ${name}`)
  const lines = definitions.get(key)
  if (lines === undefined) return
  const nextAncestors = new Set([...ancestors, key])
  for (const line of lines) {
    const tokens = spiceWords(line)
    const device = tokens[0].toLowerCase()
    if (device.startsWith("v")) yield `i(v.${path}.${device})`
    if (!device.startsWith("x")) continue
    yield* collectBranchSaves({
      name: tokens.at(-1)!,
      path: `${path}.${device}`,
      ancestors: nextAncestors,
      definitions,
    })
  }
}
