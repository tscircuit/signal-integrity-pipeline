/** The deeply readonly view returned for a tree of plain stage values. */
export type Snapshot<T> = T extends string | number | bigint | boolean | symbol
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: Snapshot<T[Key]> }
    : T

/** Copy and freeze domain values; completed stages never share mutable work state. */
export function snapshot<T>(source: T): Snapshot<T> {
  if (Array.isArray(source))
    return Object.freeze(source.map((entry) => snapshot(entry))) as Snapshot<T>
  if (typeof source === "function")
    throw new Error("Stage snapshots cannot contain functions")
  if (!source || typeof source !== "object") return source as Snapshot<T>

  const prototype = Object.getPrototypeOf(source)
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Stage snapshots require plain values")
  const entries = Object.entries(source).map(([key, entry]) => [
    key,
    snapshot(entry),
  ])
  const copy = Object.fromEntries(entries)
  if (prototype === null) Object.setPrototypeOf(copy, null)
  return Object.freeze(copy) as Snapshot<T>
}
