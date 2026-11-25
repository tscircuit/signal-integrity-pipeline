import type { Matrix } from "../kernel"
import { readPackageDefinition } from "./package-definition"
import { parseMatrix } from "./package-matrix-syntax"
import { isSpace, isUnsignedInteger, splitWords } from "./source-tokens"

/** IBIS maximum length for a package name, manufacturer, or OEM. */
const PACKAGE_NAME_LIMIT = 40
/** IBIS maximum length for the package description. */
const DESCRIPTION_LIMIT = 59
/** IBIS maximum length for a physical pin name. */
const PACKAGE_PIN_LIMIT = 5
/** IBIS section 7 lumped package data; matrix order is exactly [Pin Numbers]. */
export interface PackageModel {
  name: string
  manufacturer: string
  oem: string
  description: string
  pins: string[]
  /** Ohms in [Pin Numbers] order. */
  R: Matrix
  /** Henries in [Pin Numbers] order. */
  L: Matrix
  /** Farads in [Pin Numbers] order. */
  C: Matrix
  mergedPins?: Record<string, string>
}

/** Read a named local lumped IBIS package model. */
export function parsePackageModel(input: {
  text: string
  name: string
}): PackageModel {
  const { name } = input
  if (!name || name.length > PACKAGE_NAME_LIMIT)
    throw new Error(`${name}: invalid package name`)
  const sections = readPackageDefinition(input)
  const metadata: Record<string, string> = {}
  const pins: string[] = []
  const mergedPins: Record<string, string> = {}
  const matrices: Partial<Pick<PackageModel, "R" | "L" | "C">> = {}
  let declaredPinCount = 0
  let phase: "metadata" | "pins" | "data" | "end" = "metadata"
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const { key, argument, lines } = section
    if (
      ["manufacturer", "oem", "description", "number of pins"].includes(key)
    ) {
      if (phase !== "metadata" || key in metadata || lines.length) {
        throw new Error(`${name}: invalid or duplicate [${key}]`)
      }
      metadata[key] = argument
      if (key === "number of pins") {
        const pinCount = Number(argument)
        if (
          !isUnsignedInteger(argument) ||
          pinCount < 1 ||
          !Number.isSafeInteger(pinCount)
        ) {
          throw new Error(`${name}: invalid [Number Of Pins]`)
        }
        declaredPinCount = pinCount
        continue
      }
      let maxLength = PACKAGE_NAME_LIMIT
      if (key === "description") maxLength = DESCRIPTION_LIMIT
      if (!argument || argument.length > maxLength)
        throw new Error(`${name}: invalid [${key}]`)
      continue
    }
    if (key === "pin numbers") {
      if (phase !== "metadata" || !declaredPinCount || argument) {
        throw new Error(`${name}: [Number Of Pins] must precede [Pin Numbers]`)
      }
      for (const line of lines) {
        const pinKey = line.toLowerCase()
        const hasSectionSyntax =
          [...line].some(isSpace) || line.includes("=") || line.includes("/")
        if (hasSectionSyntax || pinKey === "fork" || pinKey === "endfork") {
          throw new Error(
            `${name}: package section syntax is unsupported in [Pin Numbers]`,
          )
        }
        if (line.length > PACKAGE_PIN_LIMIT || pins.includes(line)) {
          throw new Error(`${name}: invalid or duplicate package pin ${line}`)
        }
        pins.push(line)
      }
      if (pins.length !== declaredPinCount) {
        throw new Error(
          `${name}: package pin count ${pins.length} differs from [Number Of Pins] ${declaredPinCount}`,
        )
      }
      phase = "pins"
      continue
    }
    if (key === "merged pins") {
      if (phase !== "pins" || !pins.includes(argument) || !lines.length)
        throw new Error(
          `${name}: invalid [Merged Pins] representative ${argument}`,
        )
      for (const mergedPin of lines.flatMap(splitWords)) {
        if (pins.includes(mergedPin) || Object.hasOwn(mergedPins, mergedPin))
          throw new Error(
            `${name}: invalid or duplicate merged pin ${mergedPin}`,
          )
        mergedPins[mergedPin] = argument
      }
      continue
    }
    if (key === "model data") {
      if (phase !== "pins" || argument || lines.length)
        throw new Error(`${name}: invalid [Model Data]`)
      phase = "data"
      continue
    }
    if (key === "end model data") {
      if (phase !== "data" || argument || lines.length)
        throw new Error(`${name}: invalid [End Model Data]`)
      phase = "end"
      continue
    }
    const fields: Record<string, "R" | "L" | "C" | undefined> = {
      "resistance matrix": "R",
      "inductance matrix": "L",
      "capacitance matrix": "C",
    }
    const field = fields[key]
    if (!field || phase !== "data" || matrices[field])
      throw new Error(`${name}: unexpected or duplicate [${key}]`)
    let end = i + 1
    while (
      end < sections.length &&
      ["bandwidth", "row"].includes(sections[end].key)
    )
      end++
    matrices[field] = parseMatrix({
      sections: sections.slice(i, end),
      packagePinNames: pins,
      label: `${name} [${key}]`,
    })
    i = end - 1
  }
  for (const key of ["manufacturer", "oem", "description"]) {
    if (!(key in metadata))
      throw new Error(`${name}: required [${key.toUpperCase()}] missing`)
  }
  if (phase !== "end") throw new Error(`${name}: missing [End Model Data]`)
  if (!matrices.L || !matrices.C)
    throw new Error(`${name}: required inductance/capacitance matrix missing`)
  const model: PackageModel = {
    name,
    manufacturer: metadata.manufacturer,
    oem: metadata.oem,
    description: metadata.description,
    pins,
    R: matrices.R || pins.map(() => pins.map(() => 0)),
    L: matrices.L,
    C: matrices.C,
  }
  if (Object.keys(mergedPins).length) model.mergedPins = mergedPins
  return model
}
