// House lint rules that ESLint and its plugins do not ship. Wired up in eslint.config.mjs.
import { existsSync } from "node:fs"
import { join, relative, sep } from "node:path"

const MAX_LINES = 500
const SNAPSHOT_DIRECTORY_SUFFIX = "-snapshots"

/** Warns when a TypeScript file is longer than MAX_LINES lines. */
const maxFileLines = {
  meta: {
    type: "suggestion",
    docs: {
      description: `Warn when a TypeScript file is longer than ${MAX_LINES} lines`,
    },
    schema: [],
    messages: {
      tooLong:
        "This file has {{lines}} lines (limit {{max}}). Split it into smaller files. " +
        "If it is important to keep it as one file, add this line at the top with the reason: " +
        "/* eslint-disable local/max-file-lines -- <why this file stays whole> */",
    },
  },
  create(context) {
    return {
      Program(node) {
        const all = context.sourceCode.lines
        // A final newline leaves an empty last entry; it is not a line of the file.
        const lines = all.at(-1) === "" ? all.length - 1 : all.length
        if (lines > MAX_LINES)
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: "tooLong",
            data: { lines, max: MAX_LINES },
          })
      },
    }
  },
}

// Test folders that check the package or the tooling as a whole, not one source file.
const CROSS_CUTTING = ["tests/compat/", "tests/tooling/", "tests/support/"]

/** Matches direct test files and behaviour directories to their source files. */
const testFileMatchesSource = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A test file maps to the source file it tests",
    },
    schema: [],
    messages: {
      noSource: "{{test}} does not match a source file. Expected {{paths}}.",
    },
  },
  /** @returns {import('eslint').Rule.RuleListener} */
  create(context) {
    const root = context.cwd
    const test = relative(root, context.filename).split(sep).join("/")
    if (
      !test.startsWith("tests/") ||
      CROSS_CUTTING.some((dir) => test.startsWith(dir))
    )
      return {}
    const suffix = [".test.ts", ".test.tsx", ".test.mjs"].find((ext) =>
      test.endsWith(ext),
    )
    if (!suffix) return {}
    const base = test.slice("tests/".length, -suffix.length)
    if (
      !base ||
      ["\n", "\r", "\u2028", "\u2029"].some((char) => base.includes(char))
    )
      return {}
    const paths = [`src/${base}.ts`, `src/${base}/index.ts`]
    const separator = base.lastIndexOf("/")
    if (suffix !== ".test.mjs" && base.indexOf("/") < separator) {
      let parent = base.slice(0, separator)
      if (parent.endsWith(SNAPSHOT_DIRECTORY_SUFFIX))
        parent = parent.slice(0, -SNAPSHOT_DIRECTORY_SUFFIX.length)
      paths.push(`src/${parent}.ts`, `src/${parent}/index.ts`)
    }
    if (paths.some((path) => existsSync(join(root, path)))) return {}
    return {
      Program(node) {
        context.report({
          node,
          loc: { line: 1, column: 0 },
          messageId: "noSource",
          data: { test, paths: paths.join(" or ") },
        })
      },
    }
  },
}

/** The nodes that count as "a function" for the signature rule: anything with its own name. */
function namedFunction(node) {
  const parent = node.parent
  if (node.type === "FunctionDeclaration")
    return node.id ? node.id.name : "default export"
  if (
    parent.type === "VariableDeclarator" &&
    parent.init === node &&
    parent.id.type === "Identifier"
  ) {
    return parent.id.name
  }
  if (parent.type === "MethodDefinition" && parent.value === node)
    return parent.key.name ?? "method"
  if (parent.type === "PropertyDefinition" && parent.value === node)
    return parent.key.name ?? "property"
  return undefined
}

/** True when a parameter carries its own type annotation (`x: T`, `x: T = d`, `...xs: T[]`, `{a}: T`). */
function paramTyped(param) {
  if (param.type === "TSParameterProperty") return paramTyped(param.parameter)
  if (param.type === "AssignmentPattern")
    return Boolean(param.left.typeAnnotation)
  return Boolean(param.typeAnnotation)
}

/** Named functions spell out every parameter type and the return type in the signature. */
const typedSignature = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Named functions declare parameter and return types in their signature",
    },
    schema: [],
    messages: {
      param:
        "Function '{{name}}': give parameter {{index}} a type in the signature.",
      returns: "Function '{{name}}': declare the return type in the signature.",
    },
  },
  create(context) {
    function check(node) {
      const name = namedFunction(node)
      if (name === undefined) return
      node.params.forEach((param, i) => {
        if (!paramTyped(param))
          context.report({
            node: param,
            messageId: "param",
            data: { name, index: i + 1 },
          })
      })
      const parent = node.parent
      const noReturnType =
        parent.type === "MethodDefinition" &&
        (parent.kind === "constructor" || parent.kind === "set")
      if (!noReturnType && !node.returnType)
        context.report({
          node: node.id ?? node,
          messageId: "returns",
          data: { name },
        })
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    }
  },
}

export default {
  meta: { name: "local" },
  rules: {
    "max-file-lines": maxFileLines,
    "test-file-matches-source": testFileMatchesSource,
    "typed-signature": typedSignature,
  },
}
