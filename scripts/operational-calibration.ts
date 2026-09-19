export function calibrationRateTolerance(quantityTolerance: number, expectedQuantity: number, sampleSeconds: number, engineSeconds: number): number {
  if (![quantityTolerance, expectedQuantity, sampleSeconds, engineSeconds].every(Number.isFinite) || quantityTolerance < 0 || sampleSeconds <= 0 || engineSeconds <= 0) throw new Error('Invalid calibration tolerance input');
  return quantityTolerance / Math.min(sampleSeconds, engineSeconds) + Math.abs(expectedQuantity) * Math.abs(1 / sampleSeconds - 1 / engineSeconds);
}
