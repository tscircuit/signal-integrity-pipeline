// Fault injection at each step of the native solver lifecycle (ARCHITECTURE.md, Verification).
// os.tmpdir() reads TMPDIR on every call, so each test points it at a private directory: any
// workdir the adapter creates lands there, and "cleaned up" means that directory is empty again.
import { afterEach, test } from "bun:test"
import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeSolver, loadIbisSources } from "../../src/adapters"
import type { CircuitJson } from "../../src/board"
import { rootScope } from "../../src/kernel"
import { invoke, type SolverRequest } from "../../src/solver"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

type Sandbox = {
  root: string
  tmp: string
  tool: (body: string) => string[]
  cwdFile: string
  workdirGone: () => Promise<void>
}
/**
 * Points TMPDIR at a fresh private directory for one test and restores it afterwards, so leftover workdirs
 * are easy to spot.
 */
const sandbox = async (): Promise<Sandbox> => {
  const root = await mkdtemp(join(tmpdir(), "pcb-adapters-test-"))
  const tmp = join(root, "tmp")
  const previous = process.env.TMPDIR
  await mkdir(tmp)
  process.env.TMPDIR = tmp
  cleanups.push(async () => {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    await rm(root, { recursive: true, force: true })
  })
  assert.equal(tmpdir(), tmp)
  // The fake tool records its cwd outside the workdir, so we can assert that exact dir is gone.
  const cwdFile = join(root, "cwd.txt")
  /** Node `-e` args that record the working directory before running `body`, so the test can check for cleanup. */
  const tool = (body: string): string[] => [
    "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(cwdFile)},process.cwd());${body}`,
  ]
  /** Asserts the private tmp dir is empty again and the exact workdir the tool ran in no longer exists. */
  const workdirGone = async (): Promise<void> => {
    assert.deepEqual(await readdir(tmp), [])
    await assert.rejects(stat(await readFile(cwdFile, "utf8")), {
      code: "ENOENT",
    })
  }
  return { root, tmp, tool, cwdFile, workdirGone }
}
/** Builds an assert.rejects validator that checks the error's code and, optionally, its message. */
const code =
  (expected: string, message?: RegExp): ((error: unknown) => boolean) =>
  (error: unknown) => {
    assert.equal((error as { code: string }).code, expected)
    if (message) assert.match((error as Error).message, message)
    return true
  }

test("unsafe input or output path is rejected before any workdir exists", async () => {
  const { tmp } = await sandbox()
  const solver = createNativeSolver({ tools: { ngspice: process.execPath } })
  for (const files of [
    { "../escape": "x" },
    { "/abs": "x" },
    { "a/./b": "x" },
    { "a\\b": "x" },
    { "c:x": "x" },
    { "": "x" },
  ] as Record<string, string>[])
    await assert.rejects(
      solver({
        solver: "ngspice",
        files,
        args: ["-e", ""],
        outputFiles: [],
      }),
      code("file_path", /Expected a safe project-relative file path/),
    )
  await assert.rejects(
    solver({
      solver: "ngspice",
      files: {},
      args: ["-e", ""],
      outputFiles: ["../out"],
    }),
    code("file_path"),
  )
  await assert.rejects(
    solver({
      solver: "spice" as "ngspice",
      files: {},
      args: [],
      outputFiles: [],
    }),
    code("native_solver", /Unknown solver/),
  )
  assert.deepEqual(await readdir(tmp), [])
})

test("input write failure after mkdtemp still removes the workdir", async () => {
  const { tmp } = await sandbox()
  const solver = createNativeSolver({ tools: { ngspice: process.execPath } })
  // 'a' is written as a file, then 'a/b' needs it to be a directory.
  await assert.rejects(
    solver({
      solver: "ngspice",
      files: { a: "x", "a/b": "y" },
      args: ["-e", ""],
      outputFiles: [],
    }),
    { code: "EEXIST" },
  )
  assert.deepEqual(await readdir(tmp), [])
})

test("spawn failure (nonexistent tool) rejects native_solver and removes the workdir", async () => {
  const { root, tmp } = await sandbox()
  const solver = createNativeSolver({
    tools: { ngspice: join(root, "no-such-tool") },
  })
  const result = solver({
    solver: "ngspice",
    files: { "deck.cir": "x" },
    args: [],
    outputFiles: ["waveform.raw"],
  })
  await assert.rejects(
    result,
    code("native_solver", /^native_solver: ngspice: .*ENOENT/),
  )
  assert.deepEqual(await readdir(tmp), [])
})

test("nonzero exit rejects native_solver with logs and removes the workdir", async () => {
  const { tool, workdirGone } = await sandbox()
  const solver = createNativeSolver({ tools: { ngspice: process.execPath } })
  await assert.rejects(
    solver({
      solver: "ngspice",
      files: { "deck.cir": "x" },
      args: tool(
        `process.stdout.write('out');process.stderr.write('err');process.exit(3)`,
      ),
      outputFiles: [],
    }),
    code("native_solver", /ngspice: Command failed[\s\S]*\nout\nerr$/),
  )
  await workdirGone()
})

test("timeout kills the tool, rejects native_timeout and removes the workdir", async () => {
  const { root, tmp, tool, workdirGone } = await sandbox()
  const marker = join(root, "survived.txt")
  const solver = createNativeSolver({
    tools: { ngspice: process.execPath },
    timeoutMs: 200,
  })
  const started = Date.now()
  const writeAfterTimeout = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500)`
  const result = solver({
    solver: "ngspice",
    files: { "deck.cir": "x" },
    args: tool(writeAfterTimeout),
    outputFiles: ["out.txt"],
  })
  await assert.rejects(
    result,
    code(
      "native_timeout",
      /^native_timeout: ngspice: exceeded 200 ms process timeout; /,
    ),
  )
  assert.ok(Date.now() - started < 1500)
  await workdirGone().catch(async (error) => {
    // Under concurrent load the timeout may kill Node before its cwd marker is written.
    if (error.code !== "ENOENT") throw error
    assert.deepEqual(await readdir(tmp), [])
  })
  await new Promise((done) => setTimeout(done, 1600))
  await assert.rejects(stat(marker), { code: "ENOENT" }) // killed, not merely abandoned
})

const missingOutput =
  "missing requested output is omitted (solver.invoke rejects native_output)" +
  " and the workdir is removed"
test(missingOutput, async () => {
  const { tool, workdirGone } = await sandbox()
  const solver = createNativeSolver({ tools: { ngspice: process.execPath } })
  const request = {
    solver: "ngspice" as const,
    files: { "deck.cir": "x" },
    args: tool(`require('node:fs').writeFileSync('extra.dat','e')`),
    outputFiles: ["waveform.dat"],
  }
  const result = await solver(request)
  assert.deepEqual(Object.keys(result.files), []) // only requested outputs are read; extra.dat is not
  await workdirGone()
  await assert.rejects(
    invoke({
      context: { runSolver: solver, progress: () => {} },
      scope: rootScope("simulation"),
      request,
    }),
    code("native_output", /ngspice: missing waveform.dat/),
  )
  await workdirGone()
})

test("requested output that is a symlink out of the workdir rejects file_path and removes the workdir", async () => {
  const { root, tool, workdirGone } = await sandbox()
  const secret = join(root, "secret.txt")
  await writeFile(secret, "secret")
  const solver = createNativeSolver({ tools: { ngspice: process.execPath } })
  await assert.rejects(
    solver({
      solver: "ngspice",
      files: {},
      args: tool(
        `require('node:fs').symlinkSync(${JSON.stringify(secret)},'out.dat')`,
      ),
      outputFiles: ["out.dat"],
    }),
    code("file_path", /File must remain inside/),
  )
  await workdirGone()
})

test("loadIbisSources rejects traversal and symlinks escaping baseDir, follows contained symlinks", async () => {
  const { root } = await sandbox()
  const baseDir = join(root, "project")
  const outside = join(root, "outside.ibs")
  await mkdir(join(baseDir, "models"), { recursive: true })
  await writeFile(outside, "[IBIS Ver] 5.0")
  /** Circuit JSON that declares a single IBIS model file at `path`. */
  const declare = (path: string): CircuitJson =>
    [
      {
        type: "simulation_ibis_model",
        simulation_ibis_model_id: "m",
        ibis_model_asset: { project_relative_path: path },
      },
    ] as never
  await assert.rejects(
    loadIbisSources({
      circuitJson: declare("../outside.ibs"),
      baseDir,
    }),
    code(
      "file_path",
      /Expected a safe project-relative file path: \.\.\/outside\.ibs/,
    ),
  )
  await symlink(outside, join(baseDir, "models/file.ibs"))
  await assert.rejects(
    loadIbisSources({
      circuitJson: declare("models/file.ibs"),
      baseDir,
    }),
    code("file_path", /File must remain inside/),
  )
  await symlink(root, join(baseDir, "up")) // directory symlink escaping baseDir
  await assert.rejects(
    loadIbisSources({ circuitJson: declare("up/outside.ibs"), baseDir }),
    code("file_path"),
  )
  await writeFile(join(baseDir, "real.ibs"), "inside")
  await symlink(join(baseDir, "real.ibs"), join(baseDir, "models/link.ibs"))
  const sources = await loadIbisSources({
    circuitJson: declare("models/link.ibs"),
    baseDir,
  })
  assert.equal(
    new TextDecoder().decode(sources["models/link.ibs"] as Uint8Array),
    "inside",
  )
})

/** The fake solver holds the lock across asynchronous work to detect overlap. */
const LOCK_HOLD_MS = 30

/** A request handled by the fake ngspice process. */
function nativeTestRequest(args: string[]): SolverRequest {
  return { solver: "ngspice", files: {}, args, outputFiles: [] }
}

test("serializes native adapter instances", async () => {
  const { root, tool } = await sandbox()
  const lockPath = JSON.stringify(join(root, "active"))
  const body = `
    const fs = require('node:fs')
    fs.closeSync(fs.openSync(${lockPath}, 'wx'))
    setTimeout(() => {
      fs.unlinkSync(${lockPath})
      console.log(\`\${process.env.OMP_NUM_THREADS}:\${process.env.SPICE_ASCIIRAWFILE}\`)
    }, ${LOCK_HOLD_MS})
  `
  const first = createNativeSolver({ tools: { ngspice: process.execPath } })
  const second = createNativeSolver({ tools: { ngspice: process.execPath } })
  const request = nativeTestRequest(tool(body))
  const results = await Promise.all([
    first(request),
    second(request),
    first(request),
  ])
  assert.ok(results.every((result) => result.stdout.trim() === "1:1"))
})

test("releases the native queue after a failure", async () => {
  const { tool } = await sandbox()
  const first = createNativeSolver({ tools: { ngspice: process.execPath } })
  const second = createNativeSolver({ tools: { ngspice: process.execPath } })
  const request = nativeTestRequest(
    tool(
      'console.log(process.env.OMP_NUM_THREADS+":"+process.env.SPICE_ASCIIRAWFILE)',
    ),
  )
  await assert.rejects(first(nativeTestRequest(tool("process.exit(1)"))), {
    code: "native_solver",
  })
  assert.equal(
    (await second(request)).stdout.trim(),
    "1:1",
    "a failed native request releases the queue",
  )
})
