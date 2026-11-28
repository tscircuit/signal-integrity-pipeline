import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSolverMiddleware } from "../../../src/adapters/solver-middleware"

test("streams only the configured local Workbench board over loopback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "si-local-board-"))
  const file = join(directory, "configured.json")
  const body = "Configured board bytes.\n"
  const alternate = join(directory, "alternate.json")
  const unavailable = createSolverMiddleware()
  const configured = createSolverMiddleware({ localBoardFile: file })
  const server = createServer((request, response) => {
    let middleware = configured
    if (request.headers["x-test-config"] === "unset") middleware = unavailable
    middleware(request, response, () => response.writeHead(404).end())
  })
  try {
    await writeFile(file, body)
    await writeFile(alternate, "Other file bytes.\n")
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/api/local-boards/ddr3?path=${encodeURIComponent(alternate)}`
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-length"), `${body.length}`)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(await response.text(), body)
    const forbidden = await fetch(url, {
      headers: { Origin: "https://example.com" },
    })
    assert.equal(forbidden.status, 403)
    const unset = await fetch(url, { headers: { "x-test-config": "unset" } })
    assert.equal(unset.status, 404)
    assert.match(await unset.text(), /SI_DDR3_BOARD/)
    await rm(file)
    const missing = await fetch(url)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /SI_DDR3_BOARD/)
  } finally {
    server.close()
    server.closeAllConnections()
    await rm(directory, { recursive: true, force: true })
  }
})
