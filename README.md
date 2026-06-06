# FitTrack Backend

A production-ready REST API for the FitTrack fitness platform — built with **Express 5**, **Drizzle ORM**, **PostgreSQL (Supabase)**, and **Groq AI** for InBody body composition analysis.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Running the App](#running-the-app)
  - [Development Mode](#development-mode)
  - [Production Mode](#production-mode)
  - [Custom Port](#custom-port)
  - [Multiple Instances](#multiple-instances)
- [Database](#database)
  - [Schema Overview](#schema-overview)
  - [Drizzle Commands](#drizzle-commands)
  - [Check Connection](#check-connection)
- [API Reference](#api-reference)
  - [Health](#health)
  - [Authentication](#authentication)
  - [InBody Reports](#inbody-reports)
  - [Workout Onboarding](#workout-onboarding)
  - [Progress Tracking](#progress-tracking)
- [OCR Pipeline](#ocr-pipeline)
- [Build System](#build-system)
- [TypeScript](#typescript)
- [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express 5 |
| Database | PostgreSQL via Supabase |
| ORM | Drizzle ORM |
| AI / LLM | Groq SDK (Llama 3.1, Llama 4 Scout) |
| OCR | Groq Vision → Google Cloud Vision → OCR.space |
| Storage | Supabase Storage |
| Auth | JWT + Supabase OAuth |
| Build | esbuild |
| Language | TypeScript 6 (strict) |
| Package Manager | pnpm |
| Logger | Pino + pino-pretty |

---

## Project Structure

```
fitTrack-backend/
├── src/
│   ├── db/
│   │   ├── index.ts               # DB client — pool + drizzle instance
│   │   └── schema/                # 18 Drizzle schema files
│   │       ├── index.ts           # Re-exports all schemas
│   │       ├── users.ts           # Users, profiles, auth sessions
│   │       ├── workouts.ts        # Exercises, workout plans, sessions
│   │       ├── inbody.ts          # InBody report records
│   │       ├── analytics.ts       # Weight logs, activity summaries
│   │       ├── gyms.ts            # Gym entities
│   │       ├── memberships.ts     # Gym memberships
│   │       └── ...                # 12 more domain schemas
│   ├── lib/
│   │   ├── auth.ts                # JWT helpers, middleware, user CRUD
│   │   ├── env.ts                 # dotenv loader
│   │   ├── logger.ts              # Pino logger instance
│   │   ├── gemini.ts              # Groq AI body composition analysis
│   │   ├── exercisedb.ts          # ExerciseDB API client + static fallback
│   │   ├── inbody-ocr.ts          # OCR orchestrator (Vision → text → stub)
│   │   └── inbody-parser.ts       # Regex metric extractor
│   ├── controllers/
│   │   └── inbodyController.ts    # HTTP layer — validates input, maps errors
│   ├── services/
│   │   └── inbodyService.ts       # Business logic — DB queries + Storage ops
│   ├── routes/
│   │   ├── index.ts               # Router aggregator
│   │   ├── health.ts              # GET /api/healthz
│   │   ├── auth.ts                # Auth routes
│   │   ├── inbody.ts              # InBody routes (→ controllers/)
│   │   ├── progress.ts            # Progress routes
│   │   ├── progress.controller.ts # Progress business logic
│   │   ├── workout-onboarding.ts  # Workout onboarding routes
│   │   └── workout-onboarding.controller.ts
│   ├── types/
│   │   └── bcryptjs.d.ts          # bcryptjs type declarations
│   ├── app.ts                     # Express app setup
│   └── index.ts                   # Server entry point
├── scripts/
│   ├── setup-storage.mjs          # Create Supabase Storage bucket
│   └── check-connection.mjs       # Test database connectivity
├── drizzle/
│   ├── 0001_add_gemini_analysis_to_inbody.sql
│   └── 0002_expand_exercise_library.sql
├── dist/                          # Compiled output (git-ignored)
├── .env                           # Your local env (git-ignored)
├── .env.example                   # Template — copy to .env
├── build.mjs                      # esbuild configuration
├── drizzle.config.ts              # Drizzle Kit configuration
├── package.json
├── tsconfig.json
└── pnpm-workspace.yaml
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 or higher |
| pnpm | 8 or higher |
| PostgreSQL | Via Supabase (cloud) or local |

Install pnpm if you don't have it:

```bash
npm install -g pnpm
```

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd fitTrack-backend

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp .env.example .env
# → Edit .env and fill in DATABASE_URL, JWT_SECRET, etc.

# 4. Push database schema (first time only)
pnpm db:push

# 5. Start development server
pnpm dev
```

Server starts at: **http://localhost:5000**

---

## Environment Variables

Copy `.env.example` to `.env` and fill in these values:

```env
# ─── Database ────────────────────────────────────────────────────────────────
# Supabase Dashboard → Project Settings → Database → Connection string → URI
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"

# ─── JWT ─────────────────────────────────────────────────────────────────────
JWT_SECRET="your-very-long-random-secret-at-least-32-chars"
JWT_EXPIRES_IN="7d"                          # optional, default: 7d

# ─── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL="https://[PROJECT_REF].supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"  # needed for setup-storage

# ─── AI (optional but recommended) ───────────────────────────────────────────
GROQ_API_KEY="your-groq-api-key"             # enables AI analysis + OCR vision
GROQ_MODEL="llama-3.1-8b-instant"            # optional, overrides default model

# ─── OCR (optional — used as fallback if Groq Vision fails) ──────────────────
GOOGLE_VISION_API_KEY="your-google-vision-key"
OCR_SPACE_API_KEY="your-ocr-space-key"

# ─── Server ──────────────────────────────────────────────────────────────────
PORT=5000                                    # default: 5000
NODE_ENV=development                         # development | production

# ─── Logging ─────────────────────────────────────────────────────────────────
LOG_LEVEL=info                               # trace | debug | info | warn | error
LOG_GROQ_RAW_RESPONSE=false                  # set true to log raw Groq responses
```

> **Tip:** `GROQ_API_KEY` is free to get at [console.groq.com](https://console.groq.com). Without it the server starts in fallback mode (static demo analysis).

---

## Available Scripts

| Script | Command | Description |
|---|---|---|
| `pnpm dev` | nodemon + esbuild | Watch mode — rebuilds and restarts on every `.ts` change |
| `pnpm build` | `node build.mjs` | One-shot production build → `dist/index.mjs` |
| `pnpm start` | `node dist/index.mjs` | Run the compiled production bundle |
| `pnpm typecheck` | `tsc --noEmit` | TypeScript type check (no output files) |
| `pnpm db:push` | drizzle-kit push | Apply schema changes directly to the database |
| `pnpm db:push-force` | drizzle-kit push --force | Force-apply schema (skips safety checks) |
| `pnpm db:generate` | drizzle-kit generate | Generate SQL migration files from schema diff |
| `pnpm db:migrate` | drizzle-kit migrate | Run pending migration SQL files |
| `pnpm db:check` | drizzle-kit check | Validate migration consistency |
| `pnpm db:check-connection` | node check-connection.mjs | Test DB connectivity |
| `pnpm db:studio` | drizzle-kit studio | Open Drizzle Studio (DB browser GUI) |
| `pnpm setup-storage` | node setup-storage.mjs | Create Supabase Storage bucket |

---

## Running the App

### Development Mode

Watches `src/` for TypeScript changes, rebuilds with esbuild, and hot-restarts:

```bash
pnpm dev
```

### Production Mode

Build first, then run the compiled bundle:

```bash
pnpm build
pnpm start
```

### Custom Port

Set the `PORT` environment variable before running:

```bash
# Windows PowerShell
$env:PORT=3001; pnpm dev

# Windows CMD
set PORT=3001 && pnpm dev

# Linux / macOS
PORT=3001 pnpm dev
```

Or add `PORT=3001` to your `.env` file for a permanent change.

### Multiple Instances

To run two instances simultaneously (e.g., dev + staging), use different ports and `.env` files:

**Instance 1 (Development — port 5000):**
```bash
# In terminal 1
cp .env .env.dev
# Edit .env.dev: PORT=5000

$env:NODE_ENV="development"; $env:PORT=5000; node build.mjs; node --enable-source-maps ./dist/index.mjs
```

**Instance 2 (Staging — port 5001):**
```bash
# In terminal 2
cp .env .env.staging
# Edit .env.staging: PORT=5001, point to staging DATABASE_URL

$env:PORT=5001; node --enable-source-maps ./dist/index.mjs
```

**Using dotenv-cli for named env files:**
```bash
# Install dotenv-cli globally
npm install -g dotenv-cli

# Run with a specific .env file
dotenv -e .env.dev -- pnpm start          # port 5000
dotenv -e .env.staging -- pnpm start      # port 5001
```

---

## Database

### Schema Overview

The database has **18 domain schemas** organized as:

| Schema | Tables | Description |
|---|---|---|
| `users` | users, user_profiles, auth_sessions, refresh_tokens, mfa_devices | Auth & user management |
| `workouts` | exercises, workout_plan_templates, workout_sessions, exercise_progress | Exercise library & workout tracking |
| `inbody` | inbody_reports | InBody scan uploads and AI analysis results |
| `analytics` | weight_logs, activity_summaries, user_streaks, user_achievements, daily_checkins | Progress & gamification |
| `gyms` | gyms | Gym entities |
| `memberships` | gym_memberships | Member-gym relationships |
| `diet` | Diet tracking tables | Nutrition data |
| `scheduling` | Class scheduling tables | Gym class slots |
| + 10 more | communications, support, reviews, files, audit, security, ai, lookups, attendance | Full platform support |

### Drizzle Commands

```bash
# After editing any schema file in src/db/schema/, apply changes:
pnpm db:push            # fast — directly alters tables (good for dev)
pnpm db:generate        # generate SQL migration file (good for production)
pnpm db:migrate         # apply generated SQL migrations

# Inspect with the visual GUI:
pnpm db:studio          # opens http://local.drizzle.studio
```

### Check Connection

Verify your `DATABASE_URL` is working:

```bash
pnpm db:check-connection
```

Expected output:
```
Database connection OK
┌──────────────┬───────────┬─────────────┬─────────────────────────────────────────────────────────────────┐
│ database     │ user_name │ schema_name │ version                                                         │
├──────────────┼───────────┼─────────────┼─────────────────────────────────────────────────────────────────┤
│ postgres     │ postgres  │ public      │ PostgreSQL 15.8 on aarch64-unknown-linux-gnu, compiled by...     │
└──────────────┴───────────┴─────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## API Reference

Base URL: `http://localhost:5000/api`

> All protected routes require `Authorization: Bearer <token>` header.

---

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | No | Liveness check |

**Response:**
```json
{ "status": "ok" }
```

---

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Register with email + password |
| POST | `/auth/login` | No | Login with email + password |
| POST | `/auth/login-phone` | No | Login/register with phone OTP |
| POST | `/auth/google/url` | No | Get Google OAuth redirect URL |
| POST | `/auth/google/callback` | No | Exchange Supabase session for JWT |
| GET | `/auth/me` | ✅ | Get current user profile |
| PATCH | `/auth/me` | ✅ | Update name, avatar, phone, preferences |
| DELETE | `/auth/me` | ✅ | Soft-delete account |
| GET | `/auth/profile` | ✅ | Get fresh full profile from DB |
| POST | `/auth/onboarding` | ✅ | Complete user onboarding form |
| POST | `/auth/logout` | ✅ | Logout (stateless — client drops token) |

**Register body:**
```json
{
  "email": "user@example.com",
  "password": "min8chars",
  "username": "nikhil123",
  "role": "member"
}
```

**Login response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Nikhil",
    "role": "member",
    "onboardingCompleted": false
  }
}
```

---

### InBody Reports

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/inbody/upload` | ✅ | Upload InBody report image/PDF → OCR → AI analysis |
| POST | `/inbody/analyze/:reportId` | ✅ | Re-run AI analysis on existing report |
| GET | `/inbody/reports` | ✅ | List all user's reports (newest first) |
| GET | `/inbody/reports/:id` | ✅ | Get single report with full AI analysis |
| DELETE | `/inbody/reports/:id` | ✅ | Delete report from DB + remove file from storage |

**Upload** (`multipart/form-data`):
- Field name: `report`
- Accepted: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`
- Max size: 10 MB

**Upload response:**
```json
{
  "success": true,
  "reportId": "uuid",
  "extractedMetrics": {
    "weight": "109.6",
    "bodyFat": "41.5",
    "bmi": "33.8",
    "skeletalMuscleMass": "36.2",
    "visceralFat": "22",
    "bmr": "1756"
  },
  "geminiAnalysis": {
    "overallSummary": "...",
    "bodyFatAnalysis": { },
    "workoutPlan": { }
  }
}
```

**DELETE `/inbody/reports/:id`** responses:

```json
// 200 — success
{ "success": true, "message": "Report deleted successfully" }

// 400 — invalid UUID
{ "success": false, "message": "Invalid report ID format" }

// 403 — report belongs to another user
{ "success": false, "message": "Access denied" }

// 404 — not found (or already deleted)
{ "success": false, "message": "Report not found" }
```

> **Storage behaviour:** the associated file is deleted from Supabase Storage before the DB row is removed. If storage deletion fails (e.g. bucket permissions), a warning is logged but the DB row is still deleted. The API never returns 500 just because storage cleanup failed.

> **Frontend UX hints for this endpoint:**
> - Disable the delete button and show a loading spinner while the request is in-flight
> - On `200` — remove the card from the list with a fade-out / slide-out animation
> - On `404` — silently remove from UI (already gone)
> - Show an empty state (`"No reports uploaded yet."`) when the list becomes empty
```

---

### Workout Onboarding

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/workout/onboarding/status` | ✅ | Check if onboarding is complete |
| POST | `/workout/onboarding/ai-recommend` | ✅ | AI recommends best fitness goal from InBody data |
| POST | `/workout/onboarding/generate-plan` | ✅ | Generate a full 7-day workout plan with exercises |
| POST | `/workout/onboarding/save` | ✅ | Save selected goal + generated plan |
| POST | `/workout/onboarding/reset` | ✅ | Reset onboarding (allow re-do) |

**Generate plan body:**
```json
{
  "goal": "Fat Loss",
  "level": "beginner"
}
```

`goal` must be one of: `Fat Loss` | `Muscle Gain` | `Body Recomposition` | `Strength` | `Athletic Performance` | `General Fitness`

---

### Progress Tracking

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/progress/dashboard` | ✅ | Full progress dashboard (weight trend, InBody history, achievements, score) |
| POST | `/progress/checkin` | ✅ | Submit daily check-in (energy, sleep, recovery) |
| GET | `/progress/checkin/today` | ✅ | Get today's check-in |
| GET | `/progress/checkins/recent` | ✅ | Last 14 days of check-ins |
| POST | `/progress/weight` | ✅ | Log a weight entry |
| GET | `/progress/ai-insights` | ✅ | Get AI-generated personalized fitness insights |
| GET | `/progress/fitness-score` | ✅ | Computed fitness score (0–100) |

**Daily check-in body:**
```json
{
  "energyLevel": 4,
  "sleepHours": 7.5,
  "soreness": 2,
  "mood": 4,
  "recoveryScore": 3,
  "notes": "Feeling good after leg day"
}
```

---

## OCR Pipeline

When a user uploads an InBody report, the app tries 4 extraction methods in order:

```
Upload
  │
  ├─→ 1. Groq Vision AI (images only, needs GROQ_API_KEY)
  │       Tries 3 models: llama-4-scout → llama-3.2-90b → llama-3.2-11b
  │
  ├─→ 2. Google Cloud Vision (text OCR, needs GOOGLE_VISION_API_KEY)
  │
  ├─→ 3. OCR.space (fallback text OCR, needs OCR_SPACE_API_KEY)
  │
  └─→ 4. Demo stub (built-in sample data — always available)
       Used when: no API keys set, or all methods fail
```

After extraction → Groq AI (`llama-3.1-8b-instant`) generates the full body composition analysis.

---

## Build System

The build uses **esbuild** for ultra-fast bundling:

```bash
pnpm build
```

Output: `dist/index.mjs` (~4.6 MB bundled)

Key settings in `build.mjs`:
- **Platform:** Node.js
- **Format:** ESM
- **Bundle:** All source + deps (except native modules)
- **Source maps:** Linked (separate `.mjs.map` files)
- **Pino:** Handled via `esbuild-plugin-pino` (worker files generated separately)

---

## TypeScript

```bash
# Check types without emitting files
pnpm typecheck
```

Config highlights in `tsconfig.json`:
- `"strict": true` — all strict checks enabled
- `"moduleResolution": "bundler"` — works with esbuild's resolver
- `"target": "ES2022"` — modern output
- `"paths": { "@/*": ["./src/*"] }` — alias for future use

---

## Troubleshooting

### `DATABASE_URL must be set` on startup
- Make sure you have a `.env` file (not just `.env.example`)
- Ensure `DATABASE_URL` is uncommented and has your actual credentials

### `Error: Storage bucket 'inbody-reports' was not found`
- Run `pnpm setup-storage` to create the Supabase bucket
- Make sure `SUPABASE_SERVICE_ROLE_KEY` is set in `.env`

### `pnpm db:push` fails with SSL error
- Your `DATABASE_URL` should include `?sslmode=require&uselibpqcompat=true` for Supabase
- The config auto-appends these for `*.supabase.co` URLs

### Port already in use (`EADDRINUSE`)
- Another process is using port 5000 → change `PORT=XXXX` in `.env`
- Or kill the existing process: `netstat -ano | findstr :5000` → `taskkill /PID <pid> /F`

### Build succeeds but server shows TypeScript source paths in errors
- This is correct — source maps are linked. Errors reference original `.ts` files for easier debugging.

### Groq AI returns demo/fallback analysis
- `GROQ_API_KEY` is missing or invalid → get a free key at [console.groq.com](https://console.groq.com)
- Check logs for `GROQ_API_KEY missing — using fallback analysis`

---

## Contributing

1. Make your changes in `src/`
2. Run `pnpm typecheck` — must pass with 0 errors
3. Run `pnpm build` — must succeed
4. Test with `pnpm start` (add real `DATABASE_URL` to `.env`)
