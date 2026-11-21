import { verifyKisi } from "../tests/support/kisi"

await verifyKisi()
const child = Bun.spawn(
  [process.execPath, "test", "tests/support/kisi.test.ts"],
  {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, SI_KISI_TESTS: "1" },
  },
)
process.exitCode = await child.exited
