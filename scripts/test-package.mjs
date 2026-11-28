import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)
const root = fileURLToPath(new URL("../", import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), "pcb-package-"))
const run = async (executable, args, cwd) => {
  try {
    return await exec(executable, args, {
      cwd,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    throw Error(
      `${executable} ${args.join(" ")}\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`,
    )
  }
}
try {
  const packed = JSON.parse(
    (
      await run(
        "npm",
        ["pack", "--json", "--pack-destination", temporary],
        root,
      )
    ).stdout,
  )[0]
  assert.ok(
    packed.files.every(
      (file) =>
        file.path.startsWith("dist/") ||
        ["README.md", "LICENSE", "package.json"].includes(file.path),
    ),
  )
  const privateModules = ["setup", "runtime", "cli", "pipeline"]
  assert.ok(
    !packed.files.some((file) =>
      privateModules.some((name) => file.path.includes(`dist/${name}.`)),
    ),
  )
  const consumer = join(temporary, "consumer")
  await mkdir(consumer)
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ type: "module", private: true }),
  )
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      join(temporary, packed.filename),
    ],
    consumer,
  )
  const installed = join(
    consumer,
    "node_modules/@tscircuit/signal-integrity-pipeline",
  )
  await assert.rejects(access(join(installed, "src")), { code: "ENOENT" })
  await assert.rejects(access(join(consumer, "node_modules/react")), {
    code: "ENOENT",
  })
  // circuit-json is a peer: the package never installs its own copy into a host tree.
  await assert.rejects(access(join(consumer, "node_modules/circuit-json")), {
    code: "ENOENT",
  })
  // Hosts supply circuit-json, as tscircuit does for core and the other converters.
  const circuitJsonVersion = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ).devDependencies["circuit-json"]
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      `circuit-json@${circuitJsonVersion}`,
    ],
    consumer,
  )
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  )
  assert.equal(manifest.name, "@tscircuit/signal-integrity-pipeline")
  assert.equal(manifest.main, "./dist/index.js")
  assert.equal(manifest.types, "./dist/index.d.ts")
  assert.equal(manifest.scripts.prepare, undefined)
  assert.ok(
    Object.values(manifest.peerDependenciesMeta).every((peer) => peer.optional),
  )
  // A board without transient channel simulations admits nothing and never reaches the native capability.
  await writeFile(
    join(consumer, "input.json"),
    JSON.stringify({ circuitJson: [], ibisSources: {} }),
  )
  const smoke = `
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  RoutedPipelineSolver,
  RouteTransientSolver,
  stackupFromCircuitJson,
  transmittedBits,
} from '@tscircuit/signal-integrity-pipeline'
import {createNativeSolver,loadIbisSources} from '@tscircuit/signal-integrity-pipeline/node';
const input = JSON.parse(readFileSync('input.json', 'utf8'))
const solver = new RoutedPipelineSolver({
  input,
  context: {
    runSolver: async () => {
      throw Error('no native run expected')
    },
    progress: () => {},
  },
})
solver.solve()
assert.deepEqual(solver.getOutput().channelSimulations, [])
const publicFunctions = [
  RouteTransientSolver,
  stackupFromCircuitJson,
  transmittedBits,
  createNativeSolver,
  loadIbisSources,
]
for (const value of publicFunctions) assert.equal(typeof value, 'function')
`
  await writeFile(join(consumer, "smoke.mjs"), smoke)
  await run(process.execPath, ["smoke.mjs"], consumer)
  const packedContract =
    "Packed Node exports/removal contract: passed; empty-board routed run: passed"
  console.log(`${packedContract}; no source tree or implicit peers`)
  await copyFile(
    join(root, "tests/denied-host.mjs"),
    join(consumer, "denied-host.mjs"),
  )
  await run(
    process.execPath,
    ["denied-host.mjs", manifest.name, "input.json"],
    consumer,
  )
  console.log("Packed cold import + run with host actions denied: passed")
  const types = `
import {
  RoutedPipelineSolver,
  type RoutedInspection,
  type TransientChannelSimulationPlanInput,
  type SolverRequest,
} from '@tscircuit/signal-integrity-pipeline'
import {createNativeSolver,loadIbisSources} from '@tscircuit/signal-integrity-pipeline/node';
import type {CircuitJson} from 'circuit-json'
const runSolver = createNativeSolver()
const request: SolverRequest = { solver: 'ngspice', files: {}, args: [], outputFiles: [] }
const circuitJson: CircuitJson = [{
  type: 'pcb_quote_estimate',
  pcb_quote_estimate_id: 'quote',
  pcb_board_id: 'board',
  supplier_name: 'test supplier',
  currency: 'USD',
  quantity: 1,
  estimated_at: '2026-11-02T00:00:00Z',
  is_manufacturing_cost_complete: false,
  is_landed_cost_complete: false,
}]
/** Type-check the public pipeline against a host-supplied Circuit JSON type. */
const simulate = async (circuitJson: CircuitJson): Promise<RoutedInspection> => {
  const ibisSources = await loadIbisSources({ circuitJson, baseDir: '.' })
  const problem: TransientChannelSimulationPlanInput = { circuitJson, ibisSources }
  const solver = new RoutedPipelineSolver({ input: problem, context: { runSolver, progress: () => {} } })
  await solver.solveAsync()
  return solver.getOutput()
}
void request
void circuitJson
void simulate
`
  await writeFile(join(consumer, "types.mts"), types)
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        types: [],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2023",
      },
      files: ["types.mts"],
    }),
  )
  await run(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc")],
    consumer,
  )
  console.log("Packed NodeNext declarations: passed")
  const bun = process.env.BUN ?? "bun"
  try {
    await run(bun, ["smoke.mjs"], consumer)
    console.log("Packed Bun contract: passed")
  } catch (error) {
    if (error.message.includes("ENOENT"))
      console.log("Packed Bun smoke: skipped (set BUN to the executable)")
    else throw error
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
