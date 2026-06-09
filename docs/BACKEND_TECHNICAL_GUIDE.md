# Veera Backend — Technical Guide

**Version:** 1.0.0  
**Last updated:** June 9, 2026  
**Audience:** Backend engineers, DevOps, technical leads

For product overview and user journeys, see [VEERA_COMPLETE_GUIDE.md](./VEERA_COMPLETE_GUIDE.md).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Environment & Scripts](#4-environment--scripts)
5. [Request Lifecycle](#5-request-lifecycle)
6. [API Route Map](#6-api-route-map)
7. [Core Services](#7-core-services)
8. [Database & Drizzle](#8-database--drizzle)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [AI Systems](#10-ai-systems)
11. [InBody Pipeline](#11-inbody-pipeline)
12. [Coach Review Engine](#12-coach-review-engine)
13. [Integrations](#13-integrations)
14. [Security](#14-security)
15. [Development Workflow](#15-development-workflow)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Overview

The Veera backend is a **monolithic REST API** built with Express 5 and TypeScript. It powers the Veera mobile app with:

- User auth (email, phone OTP, Google OAuth via Supabase)
- Workout sessions, diet logging, progress analytics
- InBody upload, OCR, and AI body-composition analysis
- AI coach: daily digest, weekly review, monthly report, trainer chat
- Achievements, streaks, forecasts, and fitness scoring

**Default URL:** `http://localhost:5000/api`  
**Entry point:** `src/index.ts` → `src/app.ts` → `src/routes/index.ts`

---

## 2. Architecture

### Layered design

```
HTTP Request
  → Express middleware (CORS, JSON, auth)
  → Route router (src/routes/*.ts)
  → Controller (validation, status codes)
  → Service (business logic)
  → Drizzle ORM → PostgreSQL
  → Optional: Groq, Supabase Storage, Vision/OCR APIs
```

### Design principles

| Principle | Implementation |
|-----------|----------------|
| Single database | One PostgreSQL instance (Supabase); no microservices |
| Thin routes | Routes delegate to controllers/services |
| User scoping | Every service method checks `userId` from JWT |
| AI with fallback | Groq when `GROQ_API_KEY` set; rule-based templates otherwise |
| Reuse history | Coach reviews use `historyService` buckets, not duplicate tables |

### System diagram

```
Mobile App (Expo)
       │ HTTPS + JWT
       ▼
┌──────────────────┐
│  Express API     │
│  /api/*          │
└────────┬─────────┘
         │
    ┌────┴────┬────────────┬─────────────┐
    ▼         ▼            ▼             ▼
PostgreSQL  Supabase    Groq LLM    OCR (Vision)
            Storage
```

---

## 3. Project Structure

```
fitTrack-backend/
├── src/
│   ├── index.ts              # Server bootstrap
│   ├── app.ts                # Express app + middleware
│   ├── routes/               # HTTP routers
│   │   ├── index.ts          # Mounts all route groups
│   │   ├── auth.ts
│   │   ├── inbody.ts
│   │   ├── progress.ts
│   │   ├── progress.controller.ts
│   │   ├── workouts.ts
│   │   ├── diet.ts
│   │   ├── chat.ts
│   │   ├── coach.ts
│   │   ├── achievements.ts
│   │   └── ...
│   ├── controllers/          # HTTP adapters (InBody, etc.)
│   ├── services/             # Business logic
│   │   ├── coachReviewService.ts
│   │   ├── historyService.ts
│   │   ├── forecastService.ts
│   │   ├── achievementService.ts
│   │   ├── workoutService.ts
│   │   ├── inbodyService.ts
│   │   ├── dietService.ts
│   │   ├── chatService.ts
│   │   └── ...
│   ├── lib/                  # Shared utilities
│   │   ├── auth.ts
│   │   ├── ai-coach-review.ts
│   │   ├── ai-trainer.ts
│   │   ├── gemini.ts         # Groq InBody analysis
│   │   ├── inbody-ocr.ts
│   │   └── env.ts
│   └── db/
│       ├── index.ts          # Drizzle client
│       └── schema/           # 18 domain schema files
├── drizzle/                  # Migrations
├── scripts/                  # Seeds, storage setup
├── docs/                     # This folder
├── build.mjs
├── drizzle.config.ts
└── package.json
```

---

## 4. Environment & Scripts

### Required variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase) |
| `JWT_SECRET` | Signs access tokens |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | OAuth / client operations |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage bucket setup |

### Optional but recommended

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | AI coach, InBody analysis, chat, plans |
| `GROQ_MODEL` | Override default Llama model |
| `GOOGLE_VISION_API_KEY` | OCR fallback |
| `OCR_SPACE_API_KEY` | OCR fallback |
| `PORT` | Default `5000` |

See [../README.md](../README.md) for full `.env.example` details.

### Common commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Watch mode (esbuild + nodemon)
pnpm build            # Production bundle → dist/
pnpm start            # Run dist/index.mjs
pnpm typecheck        # tsc --noEmit
pnpm db:push          # Apply schema to DB
pnpm db:studio        # Drizzle Studio GUI
pnpm db:seed:achievements
pnpm setup-storage    # Create inbody-reports bucket
```

---

## 5. Request Lifecycle

1. **CORS + JSON** — `app.ts` parses body, allows configured origins
2. **Auth middleware** — `requireAuth` extracts JWT, sets `req.auth.sub` (userId)
3. **Route handler** — validates input (often Zod)
4. **Service call** — business logic, DB queries
5. **Response** — JSON with appropriate HTTP status

### Error handling

- Validation errors → `400`
- Missing/invalid JWT → `401`
- Resource not found → `404`
- Unexpected errors → `500` (logged via Pino)

---

## 6. API Route Map

All routes prefixed with `/api`.

| Mount | File | Domain |
|-------|------|--------|
| `/healthz` | `health.ts` | Liveness check |
| `/auth` | `auth.ts` | Register, login, OAuth, profile |
| `/inbody` | `inbody.ts` | Upload, analyze, list reports |
| `/workout/onboarding` | `workout-onboarding.ts` | AI workout plan from InBody |
| `/workouts` | `workouts.ts` | Sessions, logs, PRs, streaks |
| `/exercises` | (workouts) | Exercise catalog search |
| `/food`, `/diet`, `/hydration`, `/nutrition` | `diet.ts` | Meals, water, targets, plans |
| `/progress` | `progress.ts` | Dashboard, history, check-in, weight |
| `/chat` | `chat.ts` | AI trainer threads |
| `/achievements` | `achievements.ts` | Badges, journey, evaluate |
| `/coach` | `coach.ts` | Daily digest, weekly/monthly reviews |
| `/motivation` | `motivation.ts` | Public quotes proxy |

### Coach endpoints (key)

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/coach/daily-digest` | Lazy-generate today's tip; `?refresh=true` forces new |
| GET | `/coach/weekly-review` | Lazy-generate current week |
| POST | `/coach/weekly-review/generate` | Force regenerate |
| GET | `/coach/monthly-report` | Lazy-generate current month |
| GET | `/coach/reports` | Saved report history |

---

## 7. Core Services

| Service | File | Responsibility |
|---------|------|----------------|
| `coachReviewService` | `services/coachReviewService.ts` | Orchestrates weekly/monthly/daily coach content; persists to `ai_plan_*` tables |
| `historyService` | `services/historyService.ts` | Unified daily buckets: steps, calories, sleep, weight |
| `forecastService` | `services/forecastService.ts` | Weight/strength forecasts for reviews |
| `achievementService` | `services/achievementService.ts` | Evaluate triggers, award badges, journey titles |
| `workoutService` | `services/workoutService.ts` | Session lifecycle, PRs, streak sync |
| `inbodyService` | `services/inbodyService.ts` | Upload, OCR, AI analysis, storage URLs |
| `dietService` | `services/dietService.ts` | Food search, meal logs |
| `dietPlanService` | `services/dietPlanService.ts` | AI meal plans, nutrition targets |
| `chatService` | `services/chatService.ts` | Trainer chat threads + Groq replies |
| `goalRecommendationEngine` | `services/goalRecommendationEngine.ts` | Goal progress, next-week targets |

---

## 8. Database & Drizzle

**ORM:** Drizzle  
**Migrations:** `drizzle/` + `drizzle.config.ts`  
**~75 tables** across **18 schema domains** in `src/db/schema/`

### Key domains

| Domain | Tables | Notes |
|--------|--------|-------|
| Users | `users`, `user_profiles`, `auth_sessions` | Identity |
| Workouts | `exercises`, `user_workout_sessions`, `exercise_logs`, `personal_records` | Training |
| InBody | `inbody_reports` | OCR metrics + `gemini_analysis` JSON |
| Analytics | `weight_logs`, `activity_summaries`, `daily_checkins`, `user_streaks`, `user_achievements` | Progress |
| Diet | `food_items`, `diet_logs`, `water_logs`, `nutrition_targets` | Nutrition |
| AI | `ai_plan_requests`, `ai_plan_responses` | Coach reviews, digests, plan requests |

### Coach persistence pattern

No separate coach tables. Reviews stored as:

- `ai_plan_requests.request_type` = `coach_weekly_review` | `coach_monthly_review` | `coach_daily_digest`
- `ai_plan_responses.response_payload` = full JSON payload
- Upserted by user + period key (week/month/day)

### Demo seed marker

Weight logs with `notes = 'fittrack_demo_seed'` are excluded from user-facing history queries (legacy internal tag).

---

## 9. Authentication & Authorization

| Method | Flow |
|--------|------|
| Email/password | `POST /auth/register`, `POST /auth/login` → JWT |
| Google OAuth | Supabase OAuth → `POST /auth/google/callback` → Veera JWT |
| Phone OTP | `POST /auth/login-phone` |

- Passwords hashed with bcrypt
- JWT in `Authorization: Bearer <token>` header
- `requireAuth` middleware on protected routes
- Services always filter by `req.auth.sub`

Default OAuth redirect scheme: `veera://auth/callback`

---

## 10. AI Systems

**Provider:** Groq (`groq-sdk`)  
**Library files:** `lib/ai-coach-review.ts`, `lib/ai-trainer.ts`, `lib/gemini.ts`

| Feature | Input | Output |
|---------|-------|--------|
| Daily digest | Yesterday's activity bucket | Tip + focus action |
| Weekly review | 7-day history + goals | Score, narrative, drivers |
| Monthly report | 30-day aggregates + InBody | Long-form report |
| InBody analysis | OCR metrics + profile | Structured JSON sections |
| Trainer chat | Message + context bundle | Conversational reply |
| Workout/diet plans | Profile + InBody + goals | Plan JSON |

When Groq is unavailable, responses include `source: "fallback"` with rule-based content.

---

## 11. InBody Pipeline

```
POST /inbody/upload (multipart)
  → Save file to Supabase Storage (inbody-reports bucket)
  → OCR: Groq Vision → Google Vision → OCR.space
  → Parse metrics (inbody-parser.ts)
  → AI analysis (gemini.ts / Groq)
  → Insert/update inbody_reports row
```

Re-analysis: `POST /inbody/analyze/:reportId` → `inbodyService.reanalyzeReport()`

---

## 12. Coach Review Engine

**Orchestrator:** `coachReviewService.ts`  
**Narrative generation:** `lib/ai-coach-review.ts`

Weekly review build steps:

1. Pull 7-day history from `historyService`
2. Compute fitness score components
3. Pull achievements, streaks, InBody trends
4. Run `forecastService` for weight/strength projections
5. Call Groq for narrative (or fallback template)
6. Upsert `ai_plan_requests` / `ai_plan_responses`
7. Return JSON to client

Daily digest uses yesterday's bucket + streak + calorie goal from `nutrition_targets`.

---

## 13. Integrations

| Service | Usage |
|---------|-------|
| Supabase PostgreSQL | Primary database |
| Supabase Auth | Google OAuth token exchange |
| Supabase Storage | InBody scan files |
| Groq | LLM inference |
| Google Cloud Vision | OCR fallback |
| OCR.space | OCR fallback |
| ExerciseDB API | Exercise catalog enrichment |

---

## 14. Security

- HTTPS in production
- CORS allow-list configured in `app.ts`
- Secrets in `.env` only (never committed)
- Service-role key used only server-side for storage
- User data scoped by `userId` in all queries
- InBody files in private bucket with signed/scoped URLs

---

## 15. Development Workflow

```bash
# Terminal 1 — backend
cd fitTrack-backend
pnpm dev

# Terminal 2 — frontend (separate repo folder)
cd FitTrack-Frontend
pnpm dev
```

Point frontend `EXPO_PUBLIC_API_URL` to `http://localhost:5000/api` (or your LAN IP for device testing).

### Adding a new endpoint

1. Add service method in `src/services/`
2. Add route + controller in `src/routes/`
3. Register router in `src/routes/index.ts` if new file
4. Run `pnpm typecheck`
5. Document in [../README.md](../README.md) API section

### Database changes

1. Edit schema in `src/db/schema/`
2. `pnpm db:generate` (migration file) or `pnpm db:push` (dev)
3. Update affected services

---

## 16. Troubleshooting

| Issue | Check |
|-------|-------|
| DB connection fails | `pnpm db:check-connection`, verify `DATABASE_URL` |
| AI returns fallback only | `GROQ_API_KEY` set and valid |
| InBody upload 500 | Supabase storage bucket exists (`pnpm setup-storage`) |
| OAuth fails | Redirect URL `veera://auth/callback` in Supabase dashboard |
| CORS errors from web | Add frontend origin to CORS config |

---

## Related docs

| Document | Location |
|----------|----------|
| Complete product guide | [VEERA_COMPLETE_GUIDE.md](./VEERA_COMPLETE_GUIDE.md) |
| API reference (detailed) | [../README.md](../README.md) |
| AI coach implementation plan | [../../AI_COACH_IMPLEMENTATION_PLAN.md](../../AI_COACH_IMPLEMENTATION_PLAN.md) |
| Frontend technical guide | [../../FitTrack-Frontend/docs/FRONTEND_TECHNICAL_GUIDE.md](../../FitTrack-Frontend/docs/FRONTEND_TECHNICAL_GUIDE.md) |

---

*Document history: June 9, 2026 — Initial backend technical guide.*
