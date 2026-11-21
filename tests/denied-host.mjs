// Runs in a fresh process so the public import graph is not already cached.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { builtinModules, registerHooks } from "node:module"

const [entry = "../dist/index.js", inputFile] = process.argv.slice(2)
const input = JSON.parse(readFileSync(inputFile ?? 0, "utf8"))
const before = JSON.stringify(input)
/** @returns {never} Reject any implicit host access. */
const denied = () => {
  throw Error("Implicit host action denied")
}
const builtin = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])
const deniedPrefixes = ["@tscircuit/core", "tsx", "http:", "https:"]
registerHooks({
  /**
   * @param {string} specifier Module requested by the public import graph.
   * @param {import('node:module').ResolveHookContext} context Resolution context.
   * @param {import('node:module').ResolveHook} next Next Node resolution hook.
   * @returns {import('node:module').ResolveFnOutput} The allowed module resolution.
   */
  resolve(specifier, context, next) {
    const deniedImport =
      builtin.has(specifier) ||
      specifier === "react" ||
      deniedPrefixes.some((prefix) => specifier.startsWith(prefix))
    if (deniedImport)
      throw Error(`Forbidden import ${specifier} from ${context.parentURL}`)
    return next(specifier, context)
  },
})
globalThis.fetch = denied
globalThis.console = new Proxy({}, { get: () => denied })
Object.defineProperty(globalThis, "process", { get: denied })
// solver-utils and the routed stages time their steps with Date.now() and performance.now();
// reading the clock is the only host access left. Constructing dates stays denied.
globalThis.Date = new Proxy(Date, { construct: denied })
const { RoutedPipelineSolver } = await import(entry)
const solver = new RoutedPipelineSolver({
  input,
  context: { runSolver: denied, progress: denied },
})
solver.solve()
assert.deepEqual(solver.getOutput().blocks, [])
assert.equal(JSON.stringify(input), before)
