import { open } from "node:fs/promises"
import type { ServerResponse } from "node:http"
import { pipeline } from "node:stream/promises"

/** Stream the configured Circuit JSON file, or report that it is unavailable. */
export async function streamLocalBoard({
  response,
  path,
}: {
  response: ServerResponse
  path?: string
}): Promise<boolean> {
  if (!path) return false
  const file = await open(path, "r").catch(() => undefined)
  if (!file) return false
  try {
    const stats = await file.stat().catch(() => undefined)
    if (!stats?.isFile()) return false
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    await pipeline(file.createReadStream(), response).catch(() =>
      response.destroy(),
    )
    return true
  } finally {
    await file.close()
  }
}
