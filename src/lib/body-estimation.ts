export interface MeasurementInput {
  weightKg: number;
  heightCm: number;
  waistCm: number;
  chestCm: number;
  age?: number;
  gender?: "male" | "female";
}

export interface EstimatedMetrics {
  weight: string;
  height: string;
  bmi: string;
  bodyFat: string;
  skeletalMuscleMass: string;
  leanBodyMass: string;
  bmr: string;
  waistHipRatio: string;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function calcBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function calcLeanBodyMassBoer(weightKg: number, heightCm: number, gender: "male" | "female"): number {
  if (gender === "female") {
    return 0.252 * weightKg + 0.473 * heightCm - 48.3;
  }
  return 0.407 * weightKg + 0.267 * heightCm - 19.2;
}

function calcBodyFatDeurenberg(bmi: number, age: number, gender: "male" | "female"): number {
  const sex = gender === "male" ? 1 : 0;
  return 1.2 * bmi + 0.23 * age - 10.8 * sex - 5.4;
}

export function calcBmrMifflin(weightKg: number, heightCm: number, age: number, gender: "male" | "female"): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === "male" ? base + 5 : base - 161;
}

export function estimateBodyComposition(input: MeasurementInput): EstimatedMetrics {
  const gender = input.gender ?? "male";
  const age = input.age ?? 30;
  const bmi = calcBmi(input.weightKg, input.heightCm);
  const bodyFat = Math.min(60, Math.max(5, calcBodyFatDeurenberg(bmi, age, gender)));
  const leanBodyMass = Math.max(input.weightKg * 0.5, calcLeanBodyMassBoer(input.weightKg, input.heightCm, gender));
  const smm = leanBodyMass * 0.52;
  const bmr = calcBmrMifflin(input.weightKg, input.heightCm, age, gender);
  const whtr = input.waistCm / input.heightCm;

  return {
    weight: round1(input.weightKg),
    height: round1(input.heightCm),
    bmi: round1(bmi),
    bodyFat: round1(bodyFat),
    skeletalMuscleMass: round1(smm),
    leanBodyMass: round1(leanBodyMass),
    bmr: String(Math.round(bmr)),
    waistHipRatio: round1(whtr),
  };
}
