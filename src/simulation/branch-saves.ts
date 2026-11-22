import { spiceSubcircuitName, spiceWords } from "./spice-header"

/** A name used to resolve a SPICE subcircuit definition. */
type SubcircuitName = string

/** Stop expanding branch names beyond this SPICE instance nesting depth. */
const MAX_SUBCIRCUIT_DEPTH = 12
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
      depth: 0,
      definitions,
    }),
  ]
}

/** ngspice prefixes subcircuit voltage devices with v.<instance path>.<device name>. */
function* collectBranchSaves({
  name,
  path,
  depth,
  definitions,
}: {
  name: SubcircuitName
  path: string
  depth: number
  definitions: ReadonlyMap<SubcircuitName, string[]>
}): Generator<string> {
  if (depth > MAX_SUBCIRCUIT_DEPTH)
    throw new Error("Recursive/deep SPICE library cannot be saved safely")
  for (const line of definitions.get(name.toLowerCase()) ?? []) {
    const tokens = spiceWords(line)
    const device = tokens[0].toLowerCase()
    if (device.startsWith("v")) yield `i(v.${path}.${device})`
    if (!device.startsWith("x")) continue
    yield* collectBranchSaves({
      name: tokens.at(-1)!,
      path: `${path}.${device}`,
      depth: depth + 1,
      definitions,
    })
  }
}
