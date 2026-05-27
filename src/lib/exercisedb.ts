/**
 * ExerciseDB Client — oss.exercisedb.dev
 * ----------------------------------------
 * Free tier (1 500 exercises, no API key).
 * Spec: GET /api/v1/exercises?bodyParts={name}&limit={n}
 * Response: { success, meta, data: [ ExerciseRaw, … ] }
 *
 * Falls back to curated static data when the API is unavailable.
 */

import { logger } from "./logger";

const BASE = "https://oss.exercisedb.dev/api/v1";
const TIMEOUT_MS = 10_000;

// ─── Canonical shape ──────────────────────────────────────────────────────────

export interface ExerciseDBExercise {
  id: string;
  name: string;
  bodyPart: string;         // first element of bodyParts[]
  target: string;           // first element of targetMuscles[]
  secondaryMuscles: string[];
  equipment: string;        // first element of equipments[]
  gifUrl: string;           // https://static.exercisedb.dev/media/{id}.gif
  instructions: string[];   // cleaned (no "Step:1 " prefix)
}

// ─── Raw API shape ────────────────────────────────────────────────────────────

interface ExerciseRaw {
  exerciseId: string;
  name: string;
  gifUrl: string;
  bodyParts: string[];
  targetMuscles: string[];
  secondaryMuscles: string[];
  equipments: string[];
  instructions: string[];
}

interface ApiResponse {
  success: boolean;
  meta?: { total: number };
  data: ExerciseRaw[];
}

// ─── Normalise ────────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Remove "Step:N " prefixes the API adds to instructions */
function cleanInstruction(s: string): string {
  return s.replace(/^Step:\d+\s*/i, "").trim();
}

function normalise(raw: ExerciseRaw): ExerciseDBExercise {
  return {
    id: raw.exerciseId,
    name: cap(raw.name ?? "Exercise"),
    bodyPart: cap(raw.bodyParts?.[0] ?? ""),
    target: cap(raw.targetMuscles?.[0] ?? ""),
    secondaryMuscles: (raw.secondaryMuscles ?? []).map(cap),
    equipment: cap(raw.equipments?.[0] ?? "body weight"),
    gifUrl: raw.gifUrl ?? "",
    instructions: (raw.instructions ?? []).map(cleanInstruction).filter(Boolean),
  };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function get(url: string): Promise<ApiResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json() as Promise<ApiResponse>;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Fetch exercises for a given body part.
 * Uses: GET /api/v1/exercises?bodyParts={bodyPart}&limit={limit}
 */
export async function fetchExercisesByBodyPart(
  bodyPart: string,
  limit = 6,
): Promise<ExerciseDBExercise[]> {
  const key = bodyPart.toLowerCase().trim();

  // Map legacy/common names to exercisedb.dev body part names
  const BODY_PART_MAP: Record<string, string> = {
    "upper arms": "upper arms",
    "lower arms": "lower arms",
    "upper legs": "upper legs",
    "lower legs": "lower legs",
    "back":        "back",
    "chest":       "chest",
    "shoulders":   "shoulders",
    "waist":       "waist",
    "cardio":      "cardio",
    "neck":        "neck",
  };
  const mapped = BODY_PART_MAP[key] ?? key;

  try {
    const url = `${BASE}/exercises?bodyParts=${encodeURIComponent(mapped)}&limit=${limit}`;
    logger.info({ url }, "exercisedb.dev fetch →");

    const payload = await get(url);

    if (!payload.success || !Array.isArray(payload.data) || payload.data.length === 0) {
      throw new Error(`Empty or failed response for bodyPart="${mapped}"`);
    }

    const exercises = payload.data.slice(0, limit).map(normalise);
    logger.info({ bodyPart: mapped, count: exercises.length, total: payload.meta?.total }, "exercisedb.dev ✓");
    return exercises;
  } catch (err: any) {
    logger.warn({ bodyPart: mapped, err: err.message }, "exercisedb.dev failed → static fallback");
    return getFallback(key, limit);
  }
}

/**
 * Fetch exercises by target muscle.
 * Uses: GET /api/v1/exercises?targetMuscles={target}&limit={limit}
 */
export async function fetchExercisesByTarget(
  target: string,
  limit = 4,
): Promise<ExerciseDBExercise[]> {
  const key = target.toLowerCase().trim();

  try {
    const url = `${BASE}/exercises?targetMuscles=${encodeURIComponent(key)}&limit=${limit}`;
    const payload = await get(url);
    if (!payload.success || !payload.data?.length) throw new Error("Empty");
    return payload.data.slice(0, limit).map(normalise);
  } catch (err: any) {
    logger.warn({ target: key, err: err.message }, "exercisedb.dev target fetch failed");
    return [];
  }
}

// ─── Static fallback ──────────────────────────────────────────────────────────

const STATIC_FALLBACK: Record<string, ExerciseDBExercise[]> = {
  chest: [
    { id: "f_chest_1", name: "Barbell Bench Press", bodyPart: "Chest", target: "Pectorals", secondaryMuscles: ["Triceps", "Delts"], equipment: "Barbell", gifUrl: "", instructions: ["Lie flat on bench, grip barbell slightly wider than shoulder-width.", "Lower the bar to mid-chest with control, keeping elbows at ~45°.", "Press up explosively to full arm extension.", "Keep shoulder blades pinched together throughout."] },
    { id: "f_chest_2", name: "Incline Dumbbell Press", bodyPart: "Chest", target: "Pectorals", secondaryMuscles: ["Triceps"], equipment: "Dumbbell", gifUrl: "", instructions: ["Set bench to 30–45° incline.", "Press dumbbells up and together at the top.", "Control the descent for 2 seconds.", "Best angle for upper chest activation."] },
    { id: "f_chest_3", name: "Cable Chest Fly", bodyPart: "Chest", target: "Pectorals", secondaryMuscles: ["Biceps"], equipment: "Cable", gifUrl: "", instructions: ["Set cables at shoulder height.", "Step forward and bring hands together in a wide arc.", "Squeeze chest hard at centre.", "Keep a slight bend in elbows throughout."] },
  ],
  back: [
    { id: "f_back_1", name: "Deadlift", bodyPart: "Back", target: "Spine", secondaryMuscles: ["Glutes", "Hamstrings", "Traps"], equipment: "Barbell", gifUrl: "", instructions: ["Stand with feet hip-width, bar over laces.", "Hinge at hips and grip bar just outside legs.", "Drive through heels and extend hips to stand.", "Keep bar close to body throughout."] },
    { id: "f_back_2", name: "Pull-ups", bodyPart: "Back", target: "Lats", secondaryMuscles: ["Biceps", "Rear Delts"], equipment: "Body Weight", gifUrl: "", instructions: ["Hang from bar with overhand grip.", "Pull body up until chin clears bar.", "Lower with control to a full dead hang.", "Engage core and avoid swinging."] },
    { id: "f_back_3", name: "Seated Cable Row", bodyPart: "Back", target: "Upper Back", secondaryMuscles: ["Biceps", "Lats"], equipment: "Cable", gifUrl: "", instructions: ["Sit upright, feet on platform.", "Pull handle to lower chest, leading with elbows.", "Pause and squeeze shoulder blades together.", "Control return to full extension."] },
  ],
  "upper legs": [
    { id: "f_legs_1", name: "Barbell Squat", bodyPart: "Upper Legs", target: "Quads", secondaryMuscles: ["Glutes", "Hamstrings", "Core"], equipment: "Barbell", gifUrl: "", instructions: ["Bar on upper traps, feet shoulder-width.", "Break parallel — hips below knee level.", "Drive knees out and keep chest tall.", "Push through heels to stand."] },
    { id: "f_legs_2", name: "Romanian Deadlift", bodyPart: "Upper Legs", target: "Hamstrings", secondaryMuscles: ["Glutes", "Lower Back"], equipment: "Barbell", gifUrl: "", instructions: ["Hold barbell at hip height, soft knee bend.", "Hinge at hips keeping back flat.", "Lower until you feel a hamstring stretch.", "Drive hips forward to return."] },
    { id: "f_legs_3", name: "Leg Press", bodyPart: "Upper Legs", target: "Quads", secondaryMuscles: ["Glutes", "Hamstrings"], equipment: "Machine", gifUrl: "", instructions: ["Place feet shoulder-width on platform.", "Lower to 90° knee angle.", "Press through heels without locking out.", "Keep lower back pressed into seat."] },
    { id: "f_legs_4", name: "Hip Thrust", bodyPart: "Upper Legs", target: "Glutes", secondaryMuscles: ["Hamstrings"], equipment: "Barbell", gifUrl: "", instructions: ["Upper back on bench, bar across hip crease.", "Drive hips up until body forms a straight line.", "Squeeze glutes hard at the top for 1 second.", "Lower with control."] },
  ],
  shoulders: [
    { id: "f_sh_1", name: "Overhead Press", bodyPart: "Shoulders", target: "Delts", secondaryMuscles: ["Triceps", "Upper Chest"], equipment: "Barbell", gifUrl: "", instructions: ["Grip bar just outside shoulders, elbows forward.", "Brace core and press overhead to lockout.", "Bar travels in a straight vertical path.", "Lower with control to collarbone level."] },
    { id: "f_sh_2", name: "Lateral Raises", bodyPart: "Shoulders", target: "Delts", secondaryMuscles: [], equipment: "Dumbbell", gifUrl: "", instructions: ["Stand with dumbbells at sides.", "Raise arms to shoulder height with slight bend.", "Lead with elbows, not wrists.", "Lower slowly over 3 seconds."] },
    { id: "f_sh_3", name: "Face Pulls", bodyPart: "Shoulders", target: "Rear Delts", secondaryMuscles: ["Traps"], equipment: "Cable", gifUrl: "", instructions: ["Set cable at face height with rope attachment.", "Pull to forehead, elbows flaring wide.", "Externally rotate wrists at end.", "Protects shoulder health and builds rear delts."] },
  ],
  "upper arms": [
    { id: "f_arm_1", name: "Barbell Curl", bodyPart: "Upper Arms", target: "Biceps", secondaryMuscles: ["Forearms"], equipment: "Barbell", gifUrl: "", instructions: ["Stand with barbell, underhand grip.", "Curl to shoulders without swinging.", "Squeeze biceps hard at top.", "Lower slowly over 3 seconds."] },
    { id: "f_arm_2", name: "Tricep Pushdown", bodyPart: "Upper Arms", target: "Triceps", secondaryMuscles: [], equipment: "Cable", gifUrl: "", instructions: ["Stand at cable machine with overhand grip.", "Keep elbows pinned to sides.", "Extend arms fully, squeeze triceps.", "Do not let elbows drift forward."] },
    { id: "f_arm_3", name: "Hammer Curl", bodyPart: "Upper Arms", target: "Biceps", secondaryMuscles: ["Brachialis", "Forearms"], equipment: "Dumbbell", gifUrl: "", instructions: ["Hold dumbbells with neutral (thumbs-up) grip.", "Curl to shoulder height keeping elbows still.", "Targets brachialis for arm thickness.", "Alternate arms or do both together."] },
  ],
  "lower legs": [
    { id: "f_calf_1", name: "Standing Calf Raise", bodyPart: "Lower Legs", target: "Calves", secondaryMuscles: [], equipment: "Machine", gifUrl: "", instructions: ["Stand on edge of platform, heels hanging.", "Rise on tiptoe as high as possible.", "Pause 1 second at top.", "Lower heels fully for full range of motion."] },
  ],
  waist: [
    { id: "f_waist_1", name: "Cable Crunch", bodyPart: "Waist", target: "Abs", secondaryMuscles: [], equipment: "Cable", gifUrl: "", instructions: ["Kneel in front of cable, rope at head height.", "Pull rope down while rounding lower back.", "Contract abs hard at the bottom.", "Return slowly under control."] },
    { id: "f_waist_2", name: "Plank", bodyPart: "Waist", target: "Abs", secondaryMuscles: ["Shoulders", "Glutes"], equipment: "Body Weight", gifUrl: "", instructions: ["Forearms on floor, body in a straight line.", "Squeeze glutes and abs hard.", "Don't let hips sag or rise.", "Hold 30–60 seconds per set."] },
    { id: "f_waist_3", name: "Hanging Leg Raise", bodyPart: "Waist", target: "Abs", secondaryMuscles: ["Hip Flexors"], equipment: "Body Weight", gifUrl: "", instructions: ["Hang from bar, arms fully extended.", "Raise knees to chest or legs to 90°.", "Control the lowering phase.", "Avoid swinging for max activation."] },
  ],
  "lower arms": [
    { id: "f_larm_1", name: "Wrist Curl", bodyPart: "Lower Arms", target: "Forearms", secondaryMuscles: [], equipment: "Dumbbell", gifUrl: "", instructions: ["Sit with forearms on thighs, palms up.", "Curl wrists up as far as possible.", "Lower slowly for full range.", "Keep forearms flat on thighs."] },
  ],
  cardio: [
    { id: "f_card_1", name: "Treadmill Intervals", bodyPart: "Cardio", target: "Cardiovascular System", secondaryMuscles: [], equipment: "Treadmill", gifUrl: "", instructions: ["Set incline to 2–5° for optimal fat burn.", "Maintain 65–75% of max heart rate.", "Alternate 1 min fast / 1 min walk.", "Aim for 20–40 minute sessions."] },
    { id: "f_card_2", name: "Stationary Bike", bodyPart: "Cardio", target: "Cardiovascular System", secondaryMuscles: ["Quads", "Glutes"], equipment: "Machine", gifUrl: "", instructions: ["Adjust seat so leg is nearly straight at bottom.", "Pedal at 70–90 RPM for fat burning.", "Keep moderate resistance throughout.", "Use steady-state or interval mode."] },
    { id: "f_card_3", name: "Jump Rope", bodyPart: "Cardio", target: "Cardiovascular System", secondaryMuscles: ["Calves", "Shoulders"], equipment: "Body Weight", gifUrl: "", instructions: ["Keep elbows close to body, wrists rotating.", "Jump just high enough for rope to pass.", "Use 30s on / 30s off for HIIT.", "High calorie burn, zero equipment needed."] },
  ],
};

function getFallback(bodyPart: string, limit: number): ExerciseDBExercise[] {
  const key = Object.keys(STATIC_FALLBACK).find(
    (k) => bodyPart.includes(k) || k.includes(bodyPart),
  );
  const list = key ? STATIC_FALLBACK[key] : STATIC_FALLBACK.cardio;
  return list.slice(0, limit);
}
