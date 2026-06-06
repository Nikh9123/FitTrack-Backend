export function lbToKg(lb: number): number {
  return Math.round(lb * 0.453592 * 10) / 10;
}

export function kgToLb(kg: number): number {
  return Math.round(kg / 0.453592 * 10) / 10;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54 * 10) / 10;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}
