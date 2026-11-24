import { readFileSync, writeFileSync } from "node:fs"
import { routedStages } from "../src/pipeline"

/** Generate both documentation views from the same tuple used by the debugger. */
export function routedStageDocumentation(): string {
  const names = routedStages.map((stage) => stage.solverName)
  const rows = names.map((name, i) => `| ${i + 1} | ${name} |`)
  const table = ["| # | Stage solver |", "|---|---|", ...rows].join("\n")

  const nodes = names.map((name, i) => {
    let step = "Plan one transient channel simulation per step"
    if (i > 0) step = "All planned channel simulations, one item per step"
    return `  s${i}["${name}<br/>${step}"]`
  })
  const nextStages = names.slice(1)
  const edges = nextStages.map((_, i) => `  s${i} --> s${i + 1}`)
  const lastIndex = names.length - 1
  const nativeEdge = `  s${lastIndex} <-->|"await RunSolver"| engine["local native ngspice"]`
  const flow = ["flowchart LR", ...nodes, ...edges, nativeEdge].join("\n")

  const transitions = nextStages.map(
    (name, i) => `  ${names[i]} --> ${name}: all channel simulations completed`,
  )
  const failures = names.map((name, i) => {
    if (i === 0)
      return `  ${name} --> failed: invalid channel simulation input, including undeclared aggressors`
    return `  ${name} --> failed`
  })
  const states = [
    "stateDiagram-v2",
    `  [*] --> ${names[0]}`,
    ...transitions,
    `  ${names[lastIndex]} --> [*]`,
    ...failures,
    "  failed --> [*]",
  ].join("\n")
  return `${table}\n\n\`\`\`mermaid\n${flow}\n\`\`\`\n\n\`\`\`mermaid\n${states}\n\`\`\`\n`
}

/** Replace the first complete generated channel simulation, leaving other text intact. */
function replaceRoutedStageDocumentation({
  text,
  documentation,
}: {
  text: string
  documentation: string
}): string {
  const startMarker = "<!-- routed-stages:start -->"
  const endMarker = "<!-- routed-stages:end -->"
  const start = text.indexOf(startMarker)
  if (start < 0) return text
  const end = text.indexOf(endMarker, start + startMarker.length)
  if (end < 0) return text
  return `${text.slice(0, start)}${startMarker}\n${documentation}${text.slice(end)}`
}

for (const path of ["README.md", "docs/ARCHITECTURE.md"]) {
  const text = readFileSync(path, "utf8")
  writeFileSync(
    path,
    replaceRoutedStageDocumentation({
      text,
      documentation: routedStageDocumentation(),
    }),
  )
}
