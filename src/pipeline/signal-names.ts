/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames({ a, b }: { a: string; b: string }): number {
  const left = Array.from(a, (character) => character.codePointAt(0)!)
  const right = Array.from(b, (character) => character.codePointAt(0)!)
  const sharedLength = Math.min(left.length, right.length)
  for (let i = 0; i < sharedLength; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}
