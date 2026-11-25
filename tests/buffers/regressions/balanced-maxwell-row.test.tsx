import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertPackaged } from "../../../src/buffers/package"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test.failing(
  "accepts passive Maxwell rows at the decimal rounding boundary",
  async () => {
    const input = packageInput(await renderPackageModel())
    for (const sign of ["-", ""]) {
      const ibis = source
        .replace("3p -.2p -.5p 0", `0.3p ${sign}0.1p ${sign}0.2p 0`)
        .replace("2p -.1p 0", `2p ${sign}.1p 0`)
      const result = convertPackaged({
        bytes: new TextEncoder().encode(ibis),
        input,
      })
      assert.doesNotMatch(result.source, /^CPKG1[ab] /m)
      assert.match(result.source, /^CPKG0_1a PAD0 PAD1 1e-13$/m)
    }
  },
)
