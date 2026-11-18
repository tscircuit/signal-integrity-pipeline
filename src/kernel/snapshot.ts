/** Copy and freeze domain values; completed stages never share mutable work state. */
export function snapshot<T>(source: T): T {
  if (Array.isArray(source)) return Object.freeze(source.map(entry => snapshot(entry))) as T
  if (source && typeof source === 'object') {
    if (source instanceof Map || source instanceof Set || ArrayBuffer.isView(source)) throw new Error('Stage snapshots require plain values')
    return Object.freeze(Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, snapshot(entry)]))) as T
  }
  if (typeof source === 'function') throw new Error('Stage snapshots cannot contain functions')
  return source
}
