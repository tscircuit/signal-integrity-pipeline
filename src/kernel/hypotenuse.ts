/** Two-coordinate Euclidean norm with identical arithmetic on supported JavaScript engines. */
export function hypotenuse(dx: number, dy: number): number {
  const x = Math.abs(dx)
  const y = Math.abs(dy)
  const largest = Math.max(x, y)
  if (largest === 0 || largest === Infinity) return largest
  const relative = Math.min(x, y) / largest
  return largest * Math.sqrt(1 + relative * relative)
}
