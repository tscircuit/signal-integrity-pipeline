import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { RunSolver, SolverRequest } from '../solver'
import { createNativeSolver } from './native-solver'
import { relativeFile } from './paths'

const exec = promisify(execFile)
const requestSchema = z
  .object({
    solver: z.literal('ngspice'),
    files: z.record(z.string()),
    args: z.array(z.string()).max(16),
    outputFiles: z.array(z.string()).max(256),
  })
  .strict()
export interface LocalSolver {
  available: boolean
  version?: string
}
export type LocalSolvers = Record<'ngspice', LocalSolver>
export interface SolverMiddlewareOptions {
  runSolver?: RunSolver
  detectSolvers?: () => Promise<LocalSolvers>
  maxRequestBytes?: number
  modelDirectory?: string
  boardFile?: string
}
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void
type SolverMiddlewareContext = Required<SolverMiddlewareOptions> & {
  queue: <T>(run: () => Promise<T>) => Promise<T>
  solvers?: Promise<LocalSolvers>
}
type HttpError = Error & { status?: number; code?: string }

/** Find the first executable named ngspice on PATH. */
async function findNgspice(): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const executable = join(directory, 'ngspice')
    try {
      await access(executable, constants.X_OK)
      return executable
    } catch {
      continue
    }
  }
}

/** Probe the fixed ngspice executable on the server's PATH. */
export async function detectLocalSolvers(): Promise<LocalSolvers> {
  const executable = await findNgspice()
  if (!executable) return { ngspice: { available: false } }
  let output: string
  try {
    const probe = await exec(executable, ['--version'], {
      timeout: 2000,
      maxBuffer: 65536,
      env: { ...process.env, OMP_NUM_THREADS: '1' },
    })
    output = probe.stdout + probe.stderr
  } catch (error) {
    const probe = error as { stdout?: string; stderr?: string }
    output = (probe.stdout ?? '') + (probe.stderr ?? '')
  }
  const version = output
    .split(/\r?\n/)
    .find((line) => /ngspice-/i.test(line))
    ?.replace(/^[*\s]+|[*\s]+$/g, '') ?? 'version unavailable'
  return { ngspice: { available: true, version } }
}

/** Admit the pipeline's fixed batch arguments and contained file references, never arbitrary CLI flags. */
function solverRequest(body: unknown): SolverRequest {
  const request = requestSchema.parse(body)
  const inputPaths = Object.keys(request.files)
  if (!inputPaths.length || inputPaths.length > 256) throw new Error('Expected 1–256 input files')
  for (const path of [...inputPaths, ...request.outputFiles]) relativeFile(path)
  if (
    JSON.stringify(request.args) !== '["-n","-b","-r","waveform.raw","simulation.cir"]' ||
    JSON.stringify(request.outputFiles) !== '["waveform.raw"]' ||
    JSON.stringify(inputPaths) !== '["simulation.cir"]'
  )
    throw new Error('Expected a self-contained routed ngspice batch request')
  // The routed compiler emits an inlined .save/.tran deck. Control scripts can
  // invoke shells, change cwd or load external modules, so they are never IO.
  if (/^\s*\.(?:control|include|inc|lib|sp|hdl|osdi|pre_osdi)\b/im.test(request.files['simulation.cir']))
    throw new Error('External ngspice files, modules and control scripts are disabled')

  return request
}

/** Create a reader for one bounded JSON body with its own deadline and listeners. */
async function createRequestReader(request: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    /** Stop the deadline and detach the listeners before resolving or rejecting. */
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      request.removeListener('data', chunk)
      request.removeListener('end', end)
      request.removeListener('error', finish)
      request.removeListener('aborted', aborted)
      if (!error) return
      request.resume()
      reject(error)
    }
    /** Reject a disconnected request promptly. */
    const aborted = (): void => finish(new Error('Request aborted'))
    /** Count bytes before storing each chunk. */
    const chunk = (bytes: Buffer): void => {
      size += bytes.length
      if (size > limit) return finish(Object.assign(new Error('Request body too large'), { status: 413 }))
      chunks.push(bytes)
    }
    /** Parse only a complete body. */
    const end = (): void => {
      finish()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Expected JSON request'))
      }
    }
    const timer = setTimeout(() => finish(Object.assign(new Error('Request body timed out'), { status: 408 })), 10000)
    request.on('data', chunk).once('end', end).once('error', finish).once('aborted', aborted)
  })
}

/** Keep local responses out of browser caches. */
function writeJsonResponse(response: ServerResponse, { status, body }: { status: number; body: unknown }): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

/** Return a readable JSON error to the browser adapter. */
function writeErrorResponse(response: ServerResponse, { status, message }: { status: number; message: string }): void {
  writeJsonResponse(response, { status, body: { error: message } })
}

const boardAsset = 'ddr3-board.json'
const modelAssets = ['sn74lvc1g04.ibs', 'sn65hvd72.ibs', 'sprm552c.ibs', 'W631GG6MB-12.ibs']

/** Send only explicitly allowed local assets. */
async function writeLocalAssetResponse(
  { response, name }: { response: ServerResponse; name: string },
  { boardFile, modelDirectory }: SolverMiddlewareContext,
): Promise<void> {
  let file: string | undefined
  if (name === boardAsset) file = boardFile
  if (modelAssets.includes(name)) file = join(modelDirectory, name)
  if (!file) {
    let missingAsset = name
    if (name === boardAsset) missingAsset = 'SI_DDR3_BOARD (unset)'
    return writeErrorResponse(response, { status: 404, message: `missing local asset: ${missingAsset}` })
  }
  try {
    writeJsonResponse(response, { status: 200, body: { text: await readFile(file, 'utf8') } })
  } catch {
    writeErrorResponse(response, { status: 404, message: `missing local asset: ${file}` })
  }
}

/** Read and validate the deck before reserving a solver slot. */
async function runSolverRequest(
  { request, response }: { request: IncomingMessage; response: ServerResponse },
  { maxRequestBytes, queue, runSolver }: SolverMiddlewareContext,
): Promise<void> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json')
    return writeErrorResponse(response, { status: 415, message: 'Expected application/json' })
  const input = solverRequest(await createRequestReader(request, maxRequestBytes))
  try {
    const result = await queue(() => runSolver(input))
    writeJsonResponse(response, { status: 200, body: result })
  } catch (error) {
    const failure = error as HttpError
    let status = failure.status
    if (status == null) {
      status = 502
      if (failure.code === 'native_timeout') status = 504
    }
    writeErrorResponse(response, { status, message: failure.message })
  }
}

/** Dispatch the three local API routes after the same-origin check. */
async function routeHttpRequest(
  { request, response, path }: { request: IncomingMessage; response: ServerResponse; path: string },
  context: SolverMiddlewareContext,
): Promise<void> {
  if (
    !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '') ||
    (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
  )
    return writeErrorResponse(response, { status: 403, message: 'Expected same-origin 127.0.0.1 request' })
  if (path === '/api/solvers' && request.method === 'GET') {
    context.solvers ??= context.queue(context.detectSolvers).catch((error) => {
      context.solvers = undefined
      throw error
    })
    return writeJsonResponse(response, { status: 200, body: await context.solvers })
  }
  if (path.startsWith('/api/local-assets/') && request.method === 'GET')
    return writeLocalAssetResponse({ response, name: path.slice('/api/local-assets/'.length) }, context)
  if (path === '/api/run-solver' && request.method === 'POST') return runSolverRequest({ request, response }, context)
  let status = 404
  if (path === '/api/solvers' || path === '/api/run-solver') status = 405
  writeErrorResponse(response, { status, message: 'Unknown API route or method' })
}

/** Same-origin local API. Native runs and version probes share one bounded queue and one CPU thread. */
export function createSolverMiddleware({
  runSolver = createNativeSolver({ timeoutMs: 45 * 60 * 1000 }),
  detectSolvers = detectLocalSolvers,
  maxRequestBytes = 64 * 1024 * 1024,
  modelDirectory = process.env.IBIS_MODEL_DIR ?? 'models',
  boardFile = process.env.SI_DDR3_BOARD ?? join(modelDirectory, boardAsset),
}: SolverMiddlewareOptions = {}): Middleware {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  /** Limit queued memory and preserve the slot even when a solver fails. */
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    if (pending >= 4) return Promise.reject(Object.assign(new Error('Local solver queue is full'), { status: 429 }))
    pending++
    const next = tail.then(run)
    tail = next
      .catch(() => undefined)
      .finally(() => {
        pending--
      })
    return next
  }
  const context = { runSolver, detectSolvers, maxRequestBytes, modelDirectory, boardFile, queue }
  return (request, response, next) => {
    const path = request.url?.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) return next()
    void routeHttpRequest({ request, response, path }, context).catch((error: HttpError) =>
      writeErrorResponse(response, { status: error.status ?? 400, message: error.message }),
    )
  }
}
