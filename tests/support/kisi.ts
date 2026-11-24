import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import {
  couponBoard,
  couponConfig,
  couponNet,
  type KisiCoupon,
} from "./kisi-fixtures"

const root = join(import.meta.dirname, "..", "..")
export const kisiDirectory = join(root, ".cache", "kisi")
export const kisiCli = join(kisiDirectory, "kisi.mjs")
const execute = promisify(execFile)
const positiveNumber = z.number().finite().positive()
const releaseSchema = z.object({
  version: z.string(),
  url: z.string().url(),
  sha256: z.string().length(64),
})

/** Required field-solver evidence; formula fallback and incomplete native solves are rejected. */
export const kisiReportSchema = z.object({
  net: z.string(),
  differential: z.boolean(),
  length_mm: positiveNumber,
  impedance: z.object({ mean: positiveNumber }),
  delay_ps: positiveNumber,
  segments: z
    .array(
      z.object({
        layer: z.literal("F.Cu"),
        len_mm: positiveNumber,
        z_ohm_per_line: positiveNumber,
      }),
    )
    .length(1),
  field_solver: z.object({
    cross_sections: z.literal(1),
    cross_sections_field: z.literal(1),
    target_length_coverage_pct: z.literal(100),
  }),
  field_solver_run: z.object({
    failed_now: z.literal(0),
    not_solved: z.literal(0),
  }),
  mixed_mode: z
    .object({
      source: z.literal("field solver (odd and even mode)"),
      coupled_share: z.literal(1),
      delay_ps_diff: positiveNumber,
      delay_ps_common: positiveNumber,
    })
    .nullable(),
  warnings: z.array(z.string()).length(0),
})

/** Read the reviewed upstream release identity without loading the external executable. */
async function releaseIdentity(): Promise<z.infer<typeof releaseSchema>> {
  return releaseSchema.parse(
    JSON.parse(
      await readFile(
        join(root, "tests", "fixtures", "kisi", "release.json"),
        "utf8",
      ),
    ),
  )
}

/** Validate the official executable's bytes before allowing it to run. */
export async function verifyKisi(): Promise<void> {
  const release = await releaseIdentity()
  let bytes: Buffer
  try {
    bytes = await readFile(kisiCli)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    throw new Error(
      "Missing Kisi CLI; run bun run kisi:setup before bun run test:kisi",
    )
  }
  if (createHash("sha256").update(bytes).digest("hex") !== release.sha256)
    throw new Error(
      "Cached Kisi SHA-256 mismatch; remove .cache/kisi/kisi.mjs and run bun run kisi:setup",
    )
}

/** Explicit developer setup: download and verify the release, or verify the cached copy. */
export async function setupKisi(): Promise<void> {
  try {
    await readFile(kisiCli)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const release = await releaseIdentity()
    const response = await fetch(release.url, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(`Kisi download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash("sha256").update(bytes).digest("hex") !== release.sha256)
      throw new Error("Downloaded Kisi SHA-256 mismatch")
    await mkdir(kisiDirectory, { recursive: true })
    await writeFile(kisiCli, bytes)
  }
  await verifyKisi()
}

/** Run the unmodified release on a generated coupon and preserve the complete native evidence. */
export async function runKisi(
  coupon: KisiCoupon,
): Promise<z.infer<typeof kisiReportSchema>> {
  await verifyKisi()
  const directory = join(root, ".cache", "kisi-validation", coupon.name)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const boardPath = join(directory, `${coupon.name}.kicad_pcb`)
  await writeFile(boardPath, couponBoard(coupon))
  await writeFile(
    join(directory, `${coupon.name}.kisi.json`),
    couponConfig(coupon),
  )
  const release = await releaseIdentity()
  const args = [
    kisiCli,
    "net",
    boardPath,
    couponNet(coupon),
    "--field-all",
    "--roughness",
    "smooth",
  ]
  const started = performance.now()
  let result: { stdout: string; stderr: string }
  try {
    result = await execute("node", args, {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        KISI_THREADS: "1",
        KISI_CACHE: join(kisiDirectory, "field", release.sha256),
      },
    })
  } catch (error) {
    await writeFile(join(directory, "kisi.log"), String(error))
    if (
      error instanceof Error &&
      "stdout" in error &&
      typeof error.stdout === "string"
    )
      await writeFile(join(directory, "kisi.json"), error.stdout)
    throw error
  } finally {
    await writeFile(
      join(directory, "invocation.json"),
      JSON.stringify(
        {
          executable: "node",
          version: release.version,
          sha256: release.sha256,
          args,
          durationMs: performance.now() - started,
        },
        null,
        2,
      ),
    )
  }
  await writeFile(join(directory, "kisi.json"), result.stdout)
  await writeFile(join(directory, "kisi.log"), result.stderr)
  return kisiReportSchema.parse(JSON.parse(result.stdout))
}
