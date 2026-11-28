import { describe, it } from "bun:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { Linter, type Rule, RuleTester } from "eslint"
import tseslint from "typescript-eslint"
import plugin from "../../tools/eslint/rules.mjs"

// The custom rules in tools/eslint/rules.mjs, checked on small inputs.
RuleTester.describe = describe
RuleTester.it = it
/** Resolve Bun's focused runner only for a focused case, preserving its CI guard. */
RuleTester.itOnly = (name: string, run: () => void): void => {
  it.only(name, run)
}
const rules = plugin.rules as unknown as Record<string, Rule.RuleModule>
const root = join(import.meta.dirname, "..", "..")
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })

tester.run("typed-signature", rules["typed-signature"], {
  valid: [
    'function f(a: number, b: string = "x"): void {}',
    "const g = (a: number): number => a",
    "class A { constructor(a: number) {} m(): void {} }",
    "xs.map(x => x * 2)",
  ],
  invalid: [
    { code: "function f(a: number) {}", errors: [{ messageId: "returns" }] },
    { code: "const g = (a): number => a", errors: [{ messageId: "param" }] },
    {
      code: "class A { m(a) {} }",
      errors: [{ messageId: "returns" }, { messageId: "param" }],
    },
  ],
})

tester.run("max-file-lines", rules["max-file-lines"], {
  valid: ["const a = 1\n".repeat(500)],
  invalid: [
    { code: "const a = 1\n".repeat(501), errors: [{ messageId: "tooLong" }] },
  ],
})

tester.run("test-file-matches-source", rules["test-file-matches-source"], {
  valid: [
    {
      code: "",
      filename: join(root, "tests/board/stackup.test.ts"),
      after() {
        const linter = new Linter({ cwd: root })
        const config: Linter.Config = {
          files: ["tests/**/*.{ts,tsx}"],
          plugins: { local: { rules } },
          rules: { "local/test-file-matches-source": "error" },
        }
        assert.deepEqual(
          linter.verify("", config, "tests/board/stackup/reads-layers.test.ts"),
          [],
        )
        assert.deepEqual(
          linter.verify(
            "",
            config,
            "tests/board/stackup/reads-materials.test.tsx",
          ),
          [],
        )
        assert.deepEqual(
          linter.verify(
            "",
            config,
            "tests/pipeline/topology-snapshots/point-to-point.test.tsx",
          ),
          [],
        )
        const unmatched = linter.verify(
          "",
          config,
          "tests/board/nothing-like-this/reads-layers.test.ts",
        )
        assert.deepEqual(
          unmatched.map(({ messageId }) => messageId),
          ["noSource"],
        )
      },
    },
    { code: "", filename: join(root, "tests/board/index.test.ts") },
    { code: "", filename: join(root, "tests/compat/anything.test.ts") },
  ],
  invalid: [
    {
      code: "",
      filename: join(root, "tests/board/nothing-like-this.test.ts"),
      errors: [{ messageId: "noSource" }],
    },
  ],
})
