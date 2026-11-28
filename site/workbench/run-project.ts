import type { LogEntry, SimulationRun } from "./local-run"
import type { ProjectNode, ResultNode } from "./project"

/** Build result rows from the native capture's measured output. */
export function captureNodes(runs: SimulationRun[]): ResultNode[] {
  return runs.map((run) => ({
    id: run.id,
    label: `Run #${run.id} — ${new Date(run.timestamp).toLocaleTimeString("en-GB")}`,
    fields: [
      ["Experiment", run.name],
      ["Samples", run.capture.timestampsSeconds.length],
      ["Probes", run.capture.probes.length],
      ["Qualification", run.capture.qualification],
    ],
  }))
}

/** Resolve solver diagnostics to source ports, copper records, or visible qualified names. */
export function diagnosticNode({
  root,
  entry,
}: {
  root?: ProjectNode
  entry: LogEntry
}): string | undefined {
  const queue = root ? [root] : []
  for (const node of queue) {
    if (node.children) queue.push(...node.children)
    if (!node.port && !node.copper) continue
    if (
      entry.targets?.includes(node.id) ||
      (node.copper &&
        (entry.targets?.includes(node.copper.id) ||
          entry.message.includes(node.copper.id))) ||
      (node.port &&
        (entry.targets?.includes(node.port) ||
          entry.message.includes(node.port))) ||
      (node.label.includes(".") && entry.message.includes(node.label))
    )
      return node.id
  }
}
