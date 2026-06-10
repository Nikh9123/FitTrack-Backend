import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import ws from "ws";

/** Extract Supabase project ref from a Postgres connection string. */
export function extractSupabaseProjectRef(databaseUrl: string): string | null {
  const poolerMatch = databaseUrl.match(/postgres\.([a-z0-9]+)@/i);
  if (poolerMatch) return poolerMatch[1];

  const directMatch = databaseUrl.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (directMatch) return directMatch[1];

  return null;
}

export function resolveSupabaseUrl(): string {
  const explicit = process.env.SUPABASE_URL?.trim();
  if (explicit && !explicit.includes("placeholder")) {
    return explicit.replace(/\/$/, "");
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  const ref = extractSupabaseProjectRef(dbUrl);
  if (ref) return `https://${ref}.supabase.co`;

  return "";
}

export function resolveSupabaseAnonKey(): string {
  return process.env.SUPABASE_ANON_KEY?.trim() ?? "";
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(resolveSupabaseUrl());
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = resolveSupabaseUrl();
  if (!url) return null;

  if (!cachedClient) {
    // OAuth URL generation works without a real anon key; storage/admin features need SUPABASE_ANON_KEY.
    const anonKey = resolveSupabaseAnonKey() || "public-anon-key";
    cachedClient = createClient(url, anonKey, {
      global: {
        fetch: (url, options) => fetch(url, { ...options, duplex: "half" } as RequestInit),
      },
      realtime: {
        transport: ws,
      },
    });
  }

  return cachedClient;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(supabaseUrl: string) {
  if (!jwksCache.has(supabaseUrl)) {
    jwksCache.set(
      supabaseUrl,
      createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)),
    );
  }
  return jwksCache.get(supabaseUrl)!;
}

export interface SupabaseTokenUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

/** Verify a Supabase access token from Google OAuth without needing the anon key. */
export async function verifySupabaseAccessToken(accessToken: string): Promise<SupabaseTokenUser> {
  const url = resolveSupabaseUrl();
  if (!url) {
    throw new Error("Supabase is not configured");
  }

  const { payload } = await jwtVerify(accessToken, getJwks(url), {
    issuer: `${url}/auth/v1`,
  });

  const email = typeof payload.email === "string" ? payload.email : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const userMetadata = payload.user_metadata as SupabaseTokenUser["user_metadata"] | undefined;

  if (!sub || !email) {
    throw new Error("Token is missing required user claims");
  }

  return { id: sub, email, user_metadata: userMetadata };
}