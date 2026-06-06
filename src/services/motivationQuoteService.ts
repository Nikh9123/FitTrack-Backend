import { logger } from "../lib/logger";

export interface MotivationQuote {
  content: string;
  author: string;
}

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "FitTrack/1.0",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** https://zenquotes.io — random quote (life / wisdom) */
async function fetchFromZenQuotes(): Promise<MotivationQuote> {
  const res = await fetchWithTimeout("https://zenquotes.io/api/random");
  if (!res.ok) throw new Error(`ZenQuotes HTTP ${res.status}`);
  const data = (await res.json()) as { q?: string; a?: string } | Array<{ q?: string; a?: string }>;
  const item = Array.isArray(data) ? data[0] : data;
  if (!item?.q?.trim()) throw new Error("ZenQuotes empty response");
  return { content: item.q.trim(), author: item.a?.trim() || "Unknown" };
}

let typeFitCache: MotivationQuote[] | null = null;

/** https://type.fit/api/quotes — cached catalog, random pick */
async function fetchFromTypeFit(): Promise<MotivationQuote> {
  if (!typeFitCache) {
    const res = await fetchWithTimeout("https://type.fit/api/quotes");
    if (!res.ok) throw new Error(`TypeFit HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ text?: string; author?: string }>;
    typeFitCache = data
      .filter((row) => row.text?.trim())
      .map((row) => ({
        content: row.text!.trim(),
        author: row.author?.trim() || "Unknown",
      }));
    if (typeFitCache.length === 0) throw new Error("TypeFit empty catalog");
  }
  const idx = Math.floor(Math.random() * typeFitCache.length);
  return typeFitCache[idx];
}

const PROVIDERS: Array<{ name: string; fetch: () => Promise<MotivationQuote> }> = [
  { name: "zenquotes", fetch: fetchFromZenQuotes },
  { name: "typefit", fetch: fetchFromTypeFit },
];

/** Fetch a live quote from external APIs — no local dummy data */
export async function fetchLiveMotivationQuote(): Promise<MotivationQuote> {
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    try {
      const quote = await provider.fetch();
      logger.debug({ provider: provider.name }, "motivation quote fetched");
      return quote;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${message}`);
      logger.warn({ provider: provider.name, err: message }, "motivation quote provider failed");
    }
  }

  throw new Error(`Quote APIs unavailable (${errors.join("; ")})`);
}
