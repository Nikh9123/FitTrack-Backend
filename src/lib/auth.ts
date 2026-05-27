import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { db, userProfiles, users } from "../db";
import { eq } from "drizzle-orm";
import type { User, UserProfile } from "../db";
import { logger } from "./logger";
import { WebSocket } from "ws";

export { logger };

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
  onboardingCompleted: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPayload;
}

// ─── JWT ─────────────────────────────────────────────────────────────────────
const _JWT_SECRET_RAW = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";

if (!_JWT_SECRET_RAW && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in your environment");
}

// In development, fall back to a deterministic secret so the server can start
// without manually setting JWT_SECRET. Change this before deploying to production.
const jwtSecret: jwt.Secret =
  _JWT_SECRET_RAW ?? "dev-only-insecure-jwt-secret-CHANGE-IN-PRODUCTION";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && process.env.NODE_ENV === "production") {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
}

// Use placeholder URLs in dev if not configured — Supabase operations will
// fail gracefully at runtime, but the server will start.
export const supabase = SUPABASE_URL
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: (url, options) => fetch(url, options),
    },
    realtime: {
      transport: WebSocket,
    }
  })
  : createClient("https://placeholder.supabase.co", "placeholder-anon-key", {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: (url, options) => fetch(url, options),
    },
    realtime: {
      transport: WebSocket,
    }
  });

// ─── Token helpers ────────────────────────────────────────────────────────────
export function createJwtToken(user: User, onboardingCompleted: boolean) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.primaryRole,
      onboardingCompleted,
    },
    jwtSecret,
    {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    },
  );
}

export function verifyJwtToken(token: string) {
  return jwt.verify(token, jwtSecret) as unknown as AuthPayload;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    req.auth = verifyJwtToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
interface UserRow {
  user: User;
  profile: UserProfile | null;
}

async function getUserRowByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: users, profile: userProfiles })
    .from(users)
    .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.email, email))
    .limit(1);

  return row ?? null;
}

async function getUserRowByPhone(phone: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: users, profile: userProfiles })
    .from(users)
    .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.phone, phone))
    .limit(1);

  return row ?? null;
}

async function getUserRowById(id: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: users, profile: userProfiles })
    .from(users)
    .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.id, id))
    .limit(1);

  return row ?? null;
}

async function getUserRowByUsername(username: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: users, profile: userProfiles })
    .from(users)
    .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(users.username, username))
    .limit(1);

  return row ?? null;
}

// ─── Public user shape ────────────────────────────────────────────────────────
function formatUser(user: User, profile: UserProfile | null) {
  const firstName = profile?.firstName || "";
  const lastName = profile?.lastName ? ` ${profile.lastName}` : "";

  return {
    id: user.id,
    username: user.username ?? null,
    email: user.email ?? "",
    phone: user.phone ?? "",
    role: user.primaryRole,
    name: `${firstName}${lastName}`.trim() || "FitTrack User",
    avatar: profile?.avatarUrl ?? null,
    onboardingCompleted: profile?.onboardingCompleted ?? false,
    fitnessGoal: profile?.fitnessGoal ?? null,
    heightCm: profile?.heightCm ?? null,
    weightKg: profile?.weightKg ?? null,
    bmi: profile?.bmi ?? null,
    region: profile?.region ?? null,
    memberSince: user.createdAt.toISOString().split("T")[0],
  };
}

// ─── Exported finders ─────────────────────────────────────────────────────────
export async function findUserByEmail(email: string) {
  return getUserRowByEmail(email);
}

export async function findUserByUsername(username: string) {
  return getUserRowByUsername(username);
}

export async function findUserByPhone(phone: string) {
  return getUserRowByPhone(phone);
}

export async function findUserById(id: string) {
  return getUserRowById(id);
}

export async function updateUserProfile(userId: string, payload: {
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  preferences?: any;
}) {
  const updatesProfile: Record<string, unknown> = {};
  if (payload.firstName !== undefined) updatesProfile.firstName = payload.firstName;
  if (payload.lastName !== undefined) updatesProfile.lastName = payload.lastName;
  if (payload.avatarUrl !== undefined) updatesProfile.avatarUrl = payload.avatarUrl;

  if (Object.keys(updatesProfile).length > 0) {
    await db.update(userProfiles).set(updatesProfile).where(eq(userProfiles.userId, userId));
  }

  if (payload.phone !== undefined) {
    await db.update(users).set({ phone: payload.phone }).where(eq(users.id, userId));
  }

  // Optionally store preferences in profile (if column exists)
  if (payload.preferences !== undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.update(userProfiles) as any).set({ preferences: JSON.stringify(payload.preferences) }).where(eq(userProfiles.userId, userId));
    } catch (e) {
      // ignore if preferences column doesn't exist
    }
  }

  return getUserRowById(userId);
}

export async function deleteUserAccount(userId: string) {
  // Soft-delete: mark status as deleted and clear sensitive fields where possible
  try {
    await db.update(users).set({ status: "deleted", passwordHash: null as any }).where(eq(users.id, userId));
  } catch (e) {
    // best-effort; if schema differs, at least set status
    try {
      await db.update(users).set({ status: "deleted" }).where(eq(users.id, userId));
    } catch (err) {
      // give up
    }
  }

  return getUserRowById(userId);
}

// ─── User creation ────────────────────────────────────────────────────────────
export async function createUserWithProfile(options: {
  username?: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  role: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
  authProvider?: "email" | "google" | "phone" | "apple";
}) {
  const email =
    options.email?.trim().toLowerCase() ??
    `${options.phone?.replace(/\D/g, "") ?? "user"}@fittrack.local`;

  try {
    const [created] = await db
      .insert(users)
      .values({
        username: options.username?.trim(),
        email,
        phone: options.phone,
        passwordHash: options.passwordHash,
        primaryRole: options.role as any,
        status: "active",
        isEmailVerified: Boolean(options.email),
        isPhoneVerified: Boolean(options.phone),
      })
      .returning();

    await db.insert(userProfiles).values({
      userId: created.id,
      firstName: options.firstName ?? "",
      lastName: options.lastName ?? "",
      avatarUrl: options.avatarUrl ?? null,
      authProvider: options.authProvider ?? "email",
      onboardingCompleted: false,
    });

    return created;
  } catch (err: any) {
    // Handle unique-constraint race: if another request created the user
    // concurrently, return the existing user instead of crashing/creating a dup.
    logger.warn({ err, email, username: options.username, phone: options.phone }, "createUserWithProfile failed — checking for existing user (possible race)");

    const isPgUniqueViolation = err?.code === "23505" || /duplicate key/i.test(String(err?.message ?? ""));
    if (isPgUniqueViolation) {
      // Try to find by email, phone, then username (in that order)
      try {
        if (options.email) {
          const row = await getUserRowByEmail(options.email.trim().toLowerCase());
          if (row) return row.user;
        }
        if (options.phone) {
          const row = await getUserRowByPhone(options.phone);
          if (row) return row.user;
        }
        if (options.username) {
          const row = await getUserRowByUsername(options.username.trim().toLowerCase());
          if (row) return row.user;
        }
      } catch (e) {
        // ignore and fall through to rethrow below
      }
    }

    throw err;
  }
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
export interface OnboardingPayload {
  // Basic
  firstName?: string;
  lastName?: string;
  gender?: string;
  region?: string;
  // Fitness
  heightCm?: string;
  weightKg?: string;
  bmi?: string;
  bodyFatPercent?: string;
  fitnessGoal?: string;
  activityLevel?: string;
  dietaryPreference?: string;
  workoutExperience?: string;
  // Owner/Trainer extras stored in onboardingData JSONB
  extras?: Record<string, unknown>;
}

export async function completeOnboarding(userId: string, data: OnboardingPayload) {
  await db
    .update(userProfiles)
    .set({
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      region: data.region,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      bmi: data.bmi,
      bodyFatPercent: data.bodyFatPercent,
      fitnessGoal: data.fitnessGoal,
      activityLevel: data.activityLevel,
      dietaryPreference: data.dietaryPreference,
      workoutExperience: data.workoutExperience,
      onboardingCompleted: true,
      onboardingData: data.extras ?? null,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, userId));
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────
export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// ─── Public helpers ───────────────────────────────────────────────────────────
export function toPublicUser(user: User, profile: UserProfile | null) {
  return formatUser(user, profile);
}

export function normalizeRole(role: unknown) {
  if (typeof role !== "string") return "member";
  const normalized = role.toLowerCase();
  if (normalized === "trainer" || normalized === "owner" || normalized === "member") {
    return normalized;
  }
  return "member";
}