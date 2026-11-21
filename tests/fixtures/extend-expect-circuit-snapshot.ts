import { expect, type MatcherResult } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { CircuitJson } from "../../src/board"

// From tscircuit/core tests/fixtures/extend-expect-circuit-snapshot.ts, reduced to
// the PCB matcher. Core rasterises both SVGs and compares pixels; text then depends
// on each machine's fonts, so this compares the SVG text byte for byte instead.
expect.extend({
  toMatchPcbSnapshot(received: unknown, testPath: string): MatcherResult {
    const svg = convertCircuitJsonToPcbSvg(received as CircuitJson)
    const file = basename(testPath)
    const name = file.slice(0, file.indexOf(".test."))
    const directory = join(dirname(testPath), "__snapshots__")
    const path = join(directory, `${name}-pcb.snap.svg`)
    if (!existsSync(path) || process.env.BUN_UPDATE_SNAPSHOTS) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(path, svg)
      return { message: () => `Snapshot written to ${path}`, pass: true }
    }
    if (readFileSync(path, "utf8") === svg)
      return { message: () => "Snapshot matches", pass: true }
    return {
      message: () =>
        `Snapshot ${path} does not match; rerun with BUN_UPDATE_SNAPSHOTS=1 and review the SVG diff`,
      pass: false,
    }
  },
})

declare module "bun:test" {
  // biome-ignore lint/correctness/noUnusedVariables: merging requires bun's own type parameter
  interface Matchers<T = unknown> {
    toMatchPcbSnapshot(testPath: string): void
  }
}
