import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import type { RunSolver, SolverRequest } from "../solver"
import { createNativeSolver } from "./native-solver"
import { relativeFile } from "./paths"

const exec = promisify(execFile)
const requestSchema = z
  .object({
    solver: z.literal("ngspice"),
    files: z.record(z.string()),
    args: z.array(z.string()).max(16),
    outputFiles: z.array(z.string()).max(256),
  })
  .strict()
export interface LocalSolver {
  available: boolean
  version?: string
}
export type LocalSolvers = Record<"ngspice", LocalSolver>
export interface SolverMiddlewareOptions {
  runSolver?: RunSolver
  detectSolvers?: () => Promise<LocalSolvers>
  maxRequestBytes?: number
  modelDirectory?: string
  boardFile?: string
}
type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void
type SolverMiddlewareContext = Required<SolverMiddlewareOptions> & {
  queue: <T>(run: () => Promise<T>) => Promise<T>
  solvers?: Promise<LocalSolvers>
}
type HttpError = Error & {
  status?: number
  code?: string
}

/** Find the first executable named ngspice on PATH. */
async function findNgspice(): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue
    const executable = join(directory, "ngspice")
    try {
      await access(executable, constants.X_OK)
      return executable
    } catch {}
  }
}

/** Remove the whitespace and asterisks framing the version banner. */
function trimVersionBanner(line: string): string {
  let start = 0
  let end = line.length
  while (start < end && (line[start] === "*" || line[start].trim() === ""))
    start++
  while (end > start && (line[end - 1] === "*" || line[end - 1].trim() === ""))
    end--
  return line.slice(start, end)
}

/** Read the first ngspice version line from LF or CRLF probe output. */
function ngspiceVersion(output: string): string {
  const banner = output
    .replaceAll("\r\n", "\n")
    .split("\n")
    .find((line) => line.toLowerCase().includes("ngspice-"))
  if (banner === undefined) return "version unavailable"
  return trimVersionBanner(banner)
}

/** Probe the fixed ngspice executable on the server's PATH. */
export async function detectLocalSolvers(): Promise<LocalSolvers> {
  const executable = await findNgspice()
  if (!executable) return { ngspice: { available: false } }
  let output: string
  try {
    const probe = await exec(executable, ["--version"], {
      timeout: 2000,
      maxBuffer: 65536,
      env: { ...process.env, OMP_NUM_THREADS: "1" },
    })
    output = `${probe.stdout}${probe.stderr}`
  } catch (error) {
    const probe = error as {
      stdout?: string
      stderr?: string
    }
    output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`
  }
  const version = ngspiceVersion(output)
  return { ngspice: { available: true, version } }
}

/** Test for a single ASCII digit. */
function isDigit(character: string): boolean {
  return character >= "0" && character <= "9"
}

const END_OF_DIRECTIVE = ""

/** ASCII letters, digits and underscore can extend a directive name. */
function isDirectiveWordCharacter(
  character: string = END_OF_DIRECTIVE,
): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    isDigit(character) ||
    character === "_"
  )
}

/** Recognize external directives at the start of a deck line, after optional indentation. */
function hasExternalDirective(deck: string): boolean {
  const directives = [
    "control",
    "include",
    "inc",
    "lib",
    "sp",
    "hdl",
    "osdi",
    "pre_osdi",
  ]
  let atLineStart = true
  for (let index = 0; index < deck.length; index++) {
    const character = deck[index]
    if (
      character === "\n" ||
      character === "\r" ||
      character === "\u2028" ||
      character === "\u2029"
    ) {
      atLineStart = true
      continue
    }
    if (!atLineStart || character.trim() === "") continue
    atLineStart = false
    if (character !== ".") continue
    const start = index + 1
    for (const directive of directives) {
      const end = start + directive.length
      if (
        deck.slice(start, end).toLowerCase() === directive &&
        !isDirectiveWordCharacter(deck[end])
      )
        return true
    }
  }
  return false
}

/** Admit the pipeline's fixed batch arguments and contained file references, never arbitrary CLI flags. */
function solverRequest(body: unknown): SolverRequest {
  const request = requestSchema.parse(body)
  const inputPaths = Object.keys(request.files)
  if (!inputPaths.length || inputPaths.length > 256)
    throw new Error("Expected 1–256 input files")
  for (const path of [...inputPaths, ...request.outputFiles]) relativeFile(path)
  if (
    JSON.stringify(request.args) !==
      '["-n","-b","-r","waveform.raw","simulation.cir"]' ||
    JSON.stringify(request.outputFiles) !== '["waveform.raw"]' ||
    JSON.stringify(inputPaths) !== '["simulation.cir"]'
  )
    throw new Error("Expected a self-contained routed ngspice batch request")
  // The routed compiler emits an inlined .save/.tran deck. Control scripts can
  // invoke shells, change cwd or load external modules, so they are never IO.
  if (hasExternalDirective(request.files["simulation.cir"]))
    throw new Error(
      "External ngspice files, modules and control scripts are disabled",
    )

  return request
}

/** Create a reader for one bounded JSON body with its own deadline and listeners. */
async function createRequestReader(
  request: IncomingMessage,
  limit: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    /** Stop the deadline and detach the listeners before resolving or rejecting. */
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      request.removeListener("data", chunk)
      request.removeListener("end", end)
      request.removeListener("error", finish)
      request.removeListener("aborted", aborted)
      if (!error) return
      request.resume()
      reject(error)
    }
    /** Reject a disconnected request promptly. */
    const aborted = (): void => finish(new Error("Request aborted"))
    /** Count bytes before storing each chunk. */
    const chunk = (bytes: Buffer): void => {
      size += bytes.length
      if (size > limit) {
        finish(
          Object.assign(new Error("Request body too large"), { status: 413 }),
        )
        return
      }
      chunks.push(bytes)
    }
    /** Parse only a complete body. */
    const end = (): void => {
      finish()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new Error("Expected JSON request"))
      }
    }
    const timer = setTimeout(
      () =>
        finish(
          Object.assign(new Error("Request body timed out"), { status: 408 }),
        ),
      10000,
    )
    request
      .on("data", chunk)
      .once("end", end)
      .once("error", finish)
      .once("aborted", aborted)
  })
}

/** Keep local responses out of browser caches. */
function writeJsonResponse(
  response: ServerResponse,
  {
    status,
    body,
  }: {
    status: number
    body: unknown
  },
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(JSON.stringify(body))
}

/** Return a readable JSON error to the browser adapter. */
function writeErrorResponse(
  response: ServerResponse,
  {
    status,
    message,
  }: {
    status: number
    message: string
  },
): void {
  writeJsonResponse(response, { status, body: { error: message } })
}

const boardAsset = "ddr3-board.json"
const modelAssets = [
  "sn74lvc1g04.ibs",
  "sn65hvd72.ibs",
  "sprm552c.ibs",
  "W631GG6MB-12.ibs",
]

/** Send only explicitly allowed local assets. */
async function writeLocalAssetResponse(
  {
    response,
    name,
  }: {
    response: ServerResponse
    name: string
  },
  { boardFile, modelDirectory }: SolverMiddlewareContext,
): Promise<void> {
  let file: string | undefined
  if (name === boardAsset) file = boardFile
  if (modelAssets.includes(name)) file = join(modelDirectory, name)
  if (!file) {
    let missingAsset = name
    if (name === boardAsset) missingAsset = "SI_DDR3_BOARD (unset)"
    return writeErrorResponse(response, {
      status: 404,
      message: `missing local asset: ${missingAsset}`,
    })
  }
  try {
    writeJsonResponse(response, {
      status: 200,
      body: { text: await readFile(file, "utf8") },
    })
  } catch {
    writeErrorResponse(response, {
      status: 404,
      message: `missing local asset: ${file}`,
    })
  }
}

/** Read and validate the deck before reserving a solver slot. */
async function runSolverRequest(
  {
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  },
  { maxRequestBytes, queue, runSolver }: SolverMiddlewareContext,
): Promise<void> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    return writeErrorResponse(response, {
      status: 415,
      message: "Expected application/json",
    })
  const input = solverRequest(
    await createRequestReader(request, maxRequestBytes),
  )
  try {
    const result = await queue(() => runSolver(input))
    writeJsonResponse(response, { status: 200, body: result })
  } catch (error) {
    const failure = error as HttpError
    let status = failure.status
    if (status == null) {
      status = 502
      if (failure.code === "native_timeout") status = 504
    }
    writeErrorResponse(response, { status, message: failure.message })
  }
}

const MISSING_HOST = ""

/** Require the IPv4 loopback literal followed by a nonempty decimal port. */
function isLoopbackHost(host: string = MISSING_HOST): boolean {
  const prefix = "127.0.0.1:"
  if (!host.startsWith(prefix) || host.length === prefix.length) return false
  for (let index = prefix.length; index < host.length; index++) {
    if (!isDigit(host[index])) return false
  }
  return true
}

/** Dispatch the three local API routes after the same-origin check. */
async function routeHttpRequest(
  {
    request,
    response,
    path,
  }: {
    request: IncomingMessage
    response: ServerResponse
    path: string
  },
  context: SolverMiddlewareContext,
): Promise<void> {
  if (
    !isLoopbackHost(request.headers.host) ||
    (request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`)
  )
    return writeErrorResponse(response, {
      status: 403,
      message: "Expected same-origin 127.0.0.1 request",
    })
  if (path === "/api/solvers" && request.method === "GET") {
    context.solvers ??= context.queue(context.detectSolvers).catch((error) => {
      context.solvers = undefined
      throw error
    })
    return writeJsonResponse(response, {
      status: 200,
      body: await context.solvers,
    })
  }
  if (path.startsWith("/api/local-assets/") && request.method === "GET")
    return writeLocalAssetResponse(
      { response, name: path.slice("/api/local-assets/".length) },
      context,
    )
  if (path === "/api/run-solver" && request.method === "POST")
    return runSolverRequest({ request, response }, context)
  let status = 404
  if (path === "/api/solvers" || path === "/api/run-solver") status = 405
  writeErrorResponse(response, {
    status,
    message: "Unknown API route or method",
  })
}

/** Same-origin local API. Native runs and version probes share one bounded queue and one CPU thread. */
export function createSolverMiddleware({
  runSolver = createNativeSolver({ timeoutMs: 45 * 60 * 1000 }),
  detectSolvers = detectLocalSolvers,
  maxRequestBytes = 64 * 1024 * 1024,
  modelDirectory = process.env.IBIS_MODEL_DIR ?? "models",
  boardFile = process.env.SI_DDR3_BOARD ?? join(modelDirectory, boardAsset),
}: SolverMiddlewareOptions = {}): Middleware {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  /** Limit queued memory and preserve the slot even when a solver fails. */
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    if (pending >= 4)
      return Promise.reject(
        Object.assign(new Error("Local solver queue is full"), { status: 429 }),
      )
    pending++
    const next = tail.then(run)
    tail = next
      .catch(() => undefined)
      .finally(() => {
        pending--
      })
    return next
  }
  const context = {
    runSolver,
    detectSolvers,
    maxRequestBytes,
    modelDirectory,
    boardFile,
    queue,
  }
  return (request, response, next) => {
    const path = request.url?.split("?")[0] ?? ""
    if (!path.startsWith("/api/")) return next()
    void routeHttpRequest({ request, response, path }, context).catch(
      (error: HttpError) =>
        writeErrorResponse(response, {
          status: error.status ?? 400,
          message: error.message,
        }),
    )
  }
}
