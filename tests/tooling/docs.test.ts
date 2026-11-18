import { test } from "bun:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { routedStages } from "../../src/pipeline"

const root = join(import.meta.dirname, "..", "..")
/** README.md, AGENTS.md and every Markdown file under docs/, relative to the repo root. */
const markdownFiles = (): string[] => {
  const files = ["README.md", "AGENTS.md"].filter((f) =>
    existsSync(join(root, f)),
  )
  /** Adds every .md file under this directory, recursively. */
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name)
      if (statSync(join(root, rel)).isDirectory()) walk(rel)
      else if (extname(name) === ".md") files.push(rel)
    }
  }
  if (existsSync(join(root, "docs"))) walk("docs")
  return files
}
/** The bodies of all ```mermaid fenced blocks in a Markdown string. */
function mermaidBlocks(md: string): string[] {
  const blocks: string[] = []
  const open = "```mermaid\n"
  let offset = 0
  for (
    let start = md.indexOf(open, offset);
    start !== -1;
    start = md.indexOf(open, offset)
  ) {
    const body = start + open.length
    const end = md.indexOf("```", body)
    if (end === -1) break
    blocks.push(md.slice(body, end).trim())
    offset = end + 3
  }
  return blocks
}

test("README keeps the required opening sections in order", () => {
  const headings = readFileSync(join(root, "README.md"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("## "))
  assert.deepEqual(headings.slice(0, 3), [
    "## What is it?",
    "## How to use it?",
    "## General workflow",
  ])
})

test("README general workflow has a workflow and a state machine diagram", () => {
  const md = readFileSync(join(root, "README.md"), "utf8")
  const section = md.slice(
    md.indexOf("## General workflow"),
    md.indexOf("\n## ", md.indexOf("## General workflow") + 1),
  )
  const kinds = mermaidBlocks(section).map((block) => {
    let end = 0
    while (end < block.length && block[end].trim() !== "") end++
    return block.slice(0, end)
  })
  assert.ok(kinds.includes("flowchart"), "needs a flowchart (workflow)")
  assert.ok(
    kinds.includes("stateDiagram-v2"),
    "needs a stateDiagram-v2 (state machine)",
  )
})

test("every Mermaid diagram is a workflow or a state machine", () => {
  for (const file of markdownFiles())
    for (const block of mermaidBlocks(readFileSync(join(root, file), "utf8")))
      assert.match(
        block,
        /^(flowchart|stateDiagram-v2)\b/,
        `${file}: diagram must be flowchart or stateDiagram-v2`,
      )
})

/** Every image file under this directory, recursively; none when it does not exist. */
const images = (dir: string): string[] => {
  if (!existsSync(join(root, dir))) return []
  const imageExtensions = [".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp"]
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) return images(path)
    if (imageExtensions.some((ext) => name.toLowerCase().endsWith(ext)))
      return [path]
    return []
  })
}

test("no diagram images in docs or markdown", () => {
  for (const file of markdownFiles())
    assert.doesNotMatch(
      readFileSync(join(root, file), "utf8"),
      /!\[[^\]]*\]\([^)]*\.(png|svg|jpe?g|gif|webp)(\?[^)]*)?\)/i,
      `${file}: use a mermaid block instead of an image`,
    )
  assert.deepEqual(images("docs"), [])
})

test("agent rules live only in AGENTS.md", () => {
  assert.ok(
    existsSync(join(root, "AGENTS.md")),
    "AGENTS.md is the single rules file",
  )
  for (const other of [
    "CLAUDE.md",
    ".cursorrules",
    "GEMINI.md",
    ".github/copilot-instructions.md",
  ])
    assert.ok(
      !existsSync(join(root, other)),
      `${other}: put agent rules in AGENTS.md instead`,
    )
})

/** Characters allowed in generated stage names. */
const STAGE_NAME_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"

/** Read generated stage names from numbered Markdown table rows. */
function documentedStageNames(text: string): string[] {
  const names: string[] = []
  for (const line of text
    .replaceAll("\r", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .split("\n")) {
    if (!line.startsWith("| ") || !line.endsWith(" |")) continue
    const columns = line.slice(2, -2).split(" | ")
    if (columns.length !== 2) continue
    const [number, name] = columns
    if (!number || ![...number].every((char) => char >= "0" && char <= "9"))
      continue
    if (
      !name ||
      ![...name].every((char) => STAGE_NAME_CHARACTERS.includes(char))
    )
      continue
    names.push(name)
  }
  return names
}

test("routed documentation stage order is generated from the debugger tuple", () => {
  for (const file of ["README.md", "docs/ARCHITECTURE.md"]) {
    const markdown = readFileSync(join(root, file), "utf8")
    const afterMarker = markdown.split("<!-- routed-stages:start -->")[1]
    const [text] = afterMarker.split("<!-- routed-stages:end -->")
    const names = documentedStageNames(text)
    assert.deepEqual(
      names,
      routedStages.map((stage) => stage.solverName),
    )
  }
})
