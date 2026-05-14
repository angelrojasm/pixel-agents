/** Snap to step precision to avoid 1.0 + 0.1 → 1.0999999... display. */
function snap(v: number, step: number): number {
  const decimals = (step.toString().split('.')[1] ?? '').length;
  return Number(v.toFixed(decimals));
}

export function stepperNext(value: number, step: number, min: number, max: number): number {
  void min;
  return snap(Math.min(max, value + step), step);
}

export function stepperPrev(value: number, step: number, min: number, max: number): number {
  void max;
  return snap(Math.max(min, value - step), step);
}
