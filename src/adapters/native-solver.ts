import { type ExecFileException, execFile } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import type { RunSolver, Solver, SolverRequest, SolverResult } from "../solver"
import { fail } from "./diagnostics"
import { contained, relativeFile } from "./paths"

export interface NativeSolverOptions {
  tools?: Partial<Record<Solver, string>>
}
const exec = promisify(execFile)
let nativeTail: Promise<void> = Promise.resolve()

/**
 * Executes only requests passed by the caller; never installs or downloads tools.
 * Lifecycle: validate -> mkdtemp -> write -> spawn -> collect, with rm in `finally`.
 * Cleanup runs on every path (finally). Collects only requested outputFiles, each contained in the workdir.
 */
export function createNativeSolver({
  tools = {},
}: NativeSolverOptions = {}): RunSolver {
  return async (request) => {
    const previous = nativeTail
    let release!: () => void
    nativeTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await runNativeRequest({ request, tools })
    } finally {
      release()
    }
  }
}

/** Execute one request after the shared native queue grants its slot. */
async function runNativeRequest({
  request,
  tools,
}: Required<NativeSolverOptions> & {
  request: SolverRequest
}): Promise<SolverResult> {
  if (request.solver !== "ngspice") fail("native_solver", "Unknown solver")
  for (const path of [...Object.keys(request.files), ...request.outputFiles])
    relativeFile(path)
  const directory = await mkdtemp(join(tmpdir(), "pcb-spice-"))
  try {
    for (const [path, body] of Object.entries(request.files)) {
      const target = join(directory, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body)
    }
    let run: Pick<SolverResult, "stdout" | "stderr">
    try {
      run = await exec(tools.ngspice ?? "ngspice", request.args, {
        cwd: directory,
        maxBuffer: Infinity,
        env: {
          ...process.env,
          OMP_NUM_THREADS: "1",
          SPICE_ASCIIRAWFILE: "1",
        },
      })
    } catch (error) {
      const detail = error as ExecFileException
      const logs = `\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`
      fail("native_solver", `${request.solver}: ${detail.message}${logs}`)
    }
    const files: Record<string, string> = Object.create(null)
    const root = await realpath(directory)
    for (const path of request.outputFiles) {
      try {
        files[path] = await readFile(
          contained({ root, path: await realpath(join(directory, path)) }),
          "utf8",
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        // The pipeline validates required outputs and solver diagnostics.
      }
    }
    return { ...run, files }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
