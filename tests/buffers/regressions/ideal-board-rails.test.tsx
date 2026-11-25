import { test } from "bun:test"
import assert from "node:assert/strict"
import { convert, switchingInput } from "../../fixtures/switching"

test.failing(
  "uses a single electrical constraint when the board drives zero-impedance package rails",
  async () => {
    const input = await switchingInput()
    const converted = convert({ next: input })
    assert.doesNotMatch(converted.source, /^V(?:PDN|PKG)/m)
    assert.match(converted.source, /XBUF0 PAD0 REF0 REF1 REF0 REF1 KU0 KD0 /)
  },
)
