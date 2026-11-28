import { test } from "bun:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("calculates capacitance at the shielded conductor limit in Node", () => {
  const fixture = fileURLToPath(
    new URL("../../fixtures/check-rlgc-conductor-limit.ts", import.meta.url),
  )
  execFileSync("node", ["--import", "tsx", fixture])
})
