/** Copy and freeze domain values; completed stages never share mutable work state. */
export function snapshot<T>(source: T): T {
  if (Array.isArray(source))
    return Object.freeze(source.map((entry) => snapshot(entry))) as T
  if (typeof source === "function")
    throw new Error("Stage snapshots cannot contain functions")
  if (!source || typeof source !== "object") return source

  const prototype = Object.getPrototypeOf(source)
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Stage snapshots require plain values")
  const entries = Object.entries(source).map(([key, entry]) => [
    key,
    snapshot(entry),
  ])
  return Object.freeze(Object.fromEntries(entries)) as T
}
