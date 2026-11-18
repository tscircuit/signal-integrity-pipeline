# Rules for agents and contributors

This is the only agent rules file. Do not add CLAUDE.md, GEMINI.md, .cursorrules or similar; tests/tooling/docs.test.ts fails if one appears.

## Diagrams: Mermaid only (enforced by `tests/tooling/docs.test.ts`)

1. Every diagram in this repo is a fenced ```` ```mermaid ```` block inside Markdown: README, `docs/`, and PR descriptions alike.
   Never commit or upload diagram images (PNG/SVG/JPG renders, screenshots of diagrams).
2. Each diagram is one of exactly two concepts:
   - **Workflow:** `flowchart` (data or call flow: what happens, which module owns each step).
   - **State machine:** `stateDiagram-v2` (phases, transitions, terminal and failure states).
   Anything else (module tables, file maps, rule lists) is a Markdown table, not a diagram.
3. When code changes a workflow or a state machine (new stage, new module step, new failure path), update its diagram in the same PR.

## README contract (enforced by the same test)

`README.md` starts with these sections, in this order:
1. `## What is it?`
2. `## How to use it?`
3. `## General workflow`: contains at least one `flowchart` and one `stateDiagram-v2` block.

## Code

- Use `bun run format` to format code with Biome at an 80-character line width.
- Before a PR is ready, run `bun run format:check && bun run lint && bun run check:modules && bun run check:vocabulary`
  and `bun run typecheck && bun test`. Both commands must pass.
- Relative imports have no extension: `from './stages'`, and `from '../board'` for another module (enforced by `tests/tooling/imports.test.ts`). The build adds `.js` back in `dist/`.
- Module rules, verification and migration notes: `docs/ARCHITECTURE.md`.
- Output must stay byte-identical unless the PR says otherwise: `tests/compat/` pins exports, error codes, artifact paths and hashes.

## Code style (tscircuit handbook: `tscircuit/handbook` `guides/code.md`, `guides/api-design.md`)

Clarity beats brevity. More lines are fine when they are easier to read.

### Functions
- **Use one named object for multiple inputs.** Any named function, method, named arrow or constructor that would take more
  than one parameter takes a single named object with an inline or named type. For example, call
  `sourceNetMembers({ connectivity, memberId })`.
  - Inline callbacks may use positional parameters, as in `xs.map((x, i) => …)`.
  - Keep signatures required by an interface, such as library callbacks. React components already receive a props object.
  - A pure arithmetic helper with two interchangeable operands may take them positionally, as in `times(a, b)`
    for complex multiplication.
- **Return, never override.** Return new values when transforming inputs. Do not use `push`, `splice`, `sort`, or
  field assignment on an argument or a record it contains, including Circuit JSON. Build and return a new array or
  object, then bind the result at the call site (`const next = withX({ circuit })`). Arrays created inside the
  function can be built up freely before returning.
- **Keep functions short.** Write long workflows as short orchestrators that call named stage functions.
- **Early returns and `continue`** instead of nested `if`/`else`. No value ternaries that hide a branch. Write the `if` out.
- **Top-level functions.** No nested closures or helpers defined inside other functions. The only exception is a factory whose job is to return a function.
- **No conditional spreads** (`...(x ? { a } : {})`). Build the object, then set the field in an `if`.

### Types
- **Named return types.** A function returning an object literal, tuple, nested array or a collection of id strings returns a named type with a one-line JSDoc:
  ```ts
  /** The two pins of a series resistor, capacitor or inductor, treated as wired together for a signal. */
  export type PassiveBridge = [pinA: SourcePortId, pinB: SourcePortId]
  export function passiveBridges({
    circuit,
    excluded,
  }: {
    circuit: CircuitJson
    excluded: ReadonlySet<SourcePortId>
  }): PassiveBridge[]
  ```
- **Reuse existing types before inventing one.** Check, in this order: `circuit-json`, `circuit-json-to-connectivity-map`, then `@tscircuit/props` / `@tscircuit/core`.
  - Derive ids from records: `SourcePort['source_port_id']`, not `string`.
  - Use `PcbTrace`, `PcbTraceRoutePointWire | PcbTraceRoutePointVia`, `Point` and `LayerRef` instead of hand-written `Extract<…>` or `{ x: number; y: number }`.
  - Shared ids live in `src/board/ids.ts`.
- No enums (see Lint). No back-compat aliases or shims: rename the thing and update every caller.

### Expressions
- **No `!!`.** Write the comparison: `signal.driver_disabled === true`.
- **No regular expressions in source** (`src/`, `scripts/`, `site/`, `pages/`, `examples/`). Use `startsWith`, `includes`, `indexOf`, `slice` and `split(' ')`, a `for` loop over characters, or a small named helper like `isDigit(char)`. Tests may use a regex only inside an assertion (`assert.match(message, /…/)`).
- **Name magic numbers** as constants with a one-line reason (`const PANELS_PER_EDGE = 8` for mesh resolution).

### Reuse and size
- **Prefer existing libraries.** Net membership comes from `circuit-json-to-connectivity-map`, so don't write another connectivity walk. Build its map with `new ConnectivityMap(findConnectedNetworks(groups))`, not `addConnections`: in 0.0.35, `addConnections` can overwrite an existing net id.
- **Prefer deleting code to adding it.** No fallbacks, no "restore if missing" paths, no defensive checks that another layer already owns.
- **Keep files under about 500 lines.** Split files by concern as they grow. This is a guideline.
- Keep a PR to what its title says. Unrelated cleanups go in their own PR.

## Words

- Spell out terms the first time and in names: **unit interval** (one bit time, `1 / bit_rate_bps`), not "UI". Write **pseudo-random binary sequence (PRBS)** in titles and docs. The chart tick label `2 UI` is the only exception, because space is limited there.
- All times in Circuit JSON records are `_ms` numbers. Pipeline internals use seconds and say so in the name (`defaultDurationSeconds`).

## Tests

- Reproductions and fixtures are **TSX source rendered through core**, not hand-written Circuit JSON (`tests/fixtures/signal-parts.tsx`, `signal-render.tsx`).
- Put one `test()` per file. Use a short, kebab-case filename that describes the behaviour in `tests/<module>/<source>/`. Put shared setup in `tests/fixtures/`.
- A refactor that claims "no behaviour change" proves it before merge:
  - golden checks unchanged (27 pass, 2 TODO, 2 n/a; vendor waveform records identical);
  - the 40 ns two-trace replay byte-identical (deck SHA-256 and every sample);
  - for connectivity or topology changes, an equivalence run over every example and fixture, comparing results for every port as a seed.
- ngspice and golden runs are slow. Run one at a time on a machine.

## Pull requests

- **Small and focused, stacked.** One concept per PR, e.g. "add CopperGeometryExtractionSolver", not "pipeline changes". Dependency or package bumps get their own PR at the bottom of the stack. Use GitHub native stacks (`gh stack link`).
- **Specific titles.** Say what is added and where: `feat: check IBIS pin roles and references for channel endpoints`. Not `feat: read signals`. If a PR also updates packages, the title says so.
- **Descriptions are short and plain:**
  - what the PR adds and why;
  - what it's stacked on;
  - a `### New concepts` section for every idea a reviewer meets for the first time (e.g. CopperScope, the passive bridge), with 1–3 sentences on what it is, why it's needed and where it's used;
  - a line saying so when behaviour changes, e.g. internally connected pins now joining nets.
- Every layer of a stack must pass typecheck, lint, build and its own tests on its own.
- **Never rewrite a pushed PR's history.** PRs are squash-merged, so the commits inside a PR are its review record: they show how each change, including an agent's, was made.
  - **Why:** most changes here are made by agents, so keep as much of their edit history as possible. One commit per agent step lets a reviewer:
    - read only what changed since their last review;
    - check what an agent actually changed against what it says it did;
    - revert one bad fix without losing the others.

    Review comments also stay attached to the code they were written on. Squash merging already gives `main` one clean commit per PR, so rewriting history inside a PR gains nothing.
  - Fixes are new commits. Don't amend, squash, rebase or force-push them.
  - To update a stack, merge the branch below into each PR above it, bottom to top (`git merge <branch below>`). After a lower PR is squash-merged, merge `main` into the next PR.
  - The only exception is a restructure the maintainer asks for explicitly, such as reordering, splitting or reviving PRs. Its description then says the history was rewritten.

## Private data (never commit)

- Vendor IBIS files (`*.ibs`) stay local in the gitignored `models/`. Only `examples/vendor-models.lock.json` (names and hashes) is committed.
- Real board Circuit JSON, board-derived decks, captures and extracted geometry stay local (`models/ddr3-board.json`, `.cache/`).
- `examples/level4-ddr3-write/` and `examples/ddr3-parts.tsx` are the only approved board-derived files.
- Check `git status` and the diff before every commit.

## Lint

`bun run lint` runs Biome and ESLint. Biome checks formatting, import order and
general lint rules using `biome.json`. ESLint keeps the repository rules below
in `eslint.config.mjs` and `tools/eslint/rules.mjs`.

| Rule | What it means |
|---|---|
| `jsdoc/require-jsdoc` | Named functions and methods need a JSDoc comment. Inline callbacks are exempt. |
| `local/typed-signature` | Named functions need parameter and return types in the signature. Constructors and setters do not need a return type. |
| `no-restricted-syntax` | Use a string-literal union or an `as const` object in place of an enum. |
| `local/max-file-lines` | TypeScript files over 500 lines warn. If a file needs to stay together, document the reason with `/* eslint-disable local/max-file-lines -- <reason> */` at the top. |
| `local/test-file-matches-source` | Map each behaviour file in `tests/<module>/<source>/` to `src/<module>/<source>.ts` or its directory's `index.ts`. Existing direct test paths also map to their source. Cross-cutting tests in `tests/compat`, `tests/tooling` and `tests/support` are exempt from source-file mapping. |

## Naming vocabulary (`bun run check:vocabulary`, dictionary in `tools/vocabulary.yaml`)

Build names in `src/` from the words in `tools/vocabulary.yaml`. The checker splits every declared name into words (`foldProbeEye` → fold, probe, eye) and reports the share of names made only of dictionary words. It must stay at or above the file's `threshold` (85%). 100% is not the goal.

- Give each subset of the same thing its own qualifier, as in `selectedPcbTraceIds` and `retainedPcbTraceIds`.
- Prefer a word already in the dictionary. If it lists two words for one idea, use the listed one; `avoid` names the word to use instead.
- Need a new concept? Add the word with a one-line plain-English meaning in the same PR as the code that uses it, so the reviewer sees the new word.
- List base forms only: plurals and verb forms are accepted automatically (`ids` → id, `selected` → select).
