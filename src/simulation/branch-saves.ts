import { spiceSubcircuitName, spiceWords } from "./spice-header"

type SubcircuitName = string

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
    if (line.slice(0, 5).toLowerCase() !== ".ends") current.push(line)
  }
  const saved: string[] = []
  collectBranchSaves(
    { name: wrapper, path: instance.toLowerCase(), depth: 0 },
    { definitions, saved },
  )
  return saved
}

/** ngspice prefixes subcircuit voltage devices with v.<instance path>.<device name>. */
function collectBranchSaves(
  { name, path, depth }: { name: SubcircuitName; path: string; depth: number },
  context: {
    definitions: ReadonlyMap<SubcircuitName, string[]>
    saved: string[]
  },
): void {
  if (depth > 12)
    throw new Error("Recursive/deep SPICE library cannot be saved safely")
  for (const line of context.definitions.get(name.toLowerCase()) ?? []) {
    const tokens = spiceWords(line)
    const device = tokens[0].toLowerCase()
    if (device.startsWith("v")) context.saved.push(`i(v.${path}.${device})`)
    if (device.startsWith("x"))
      collectBranchSaves(
        { name: tokens.at(-1)!, path: `${path}.${device}`, depth: depth + 1 },
        context,
      )
  }
}
