# Veera — Complete System & User Guide

**Version:** 1.0.0  
**Last updated:** June 9, 2026  
**Audience:** Everyone — from first-time users to engineers and product stakeholders

---

## Table of Contents

1. [What Is Veera? (Plain English)](#1-what-is-Veera-plain-english)
2. [Who Is It For?](#2-who-is-it-for)
3. [Problems Veera Solves](#3-problems-Veera-solves)
4. [How the App Works — User Journey](#4-how-the-app-works--user-journey)
5. [Main Features Explained Simply](#5-main-features-explained-simply)
6. [App Screens & Navigation](#6-app-screens--navigation)
7. [System Overview (Big Picture)](#7-system-overview-big-picture)
8. [Technical Architecture](#8-technical-architecture)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Backend Architecture](#10-backend-architecture)
11. [Database Design](#11-database-design)
12. [AI Coach System](#12-ai-coach-system)
13. [Key Data Flows](#13-key-data-flows)
14. [API Reference Summary](#14-api-reference-summary)
15. [Integrations & External Services](#15-integrations--external-services)
16. [Security & Privacy](#16-security--privacy)
17. [Technology Stack](#17-technology-stack)
18. [Project Structure](#18-project-structure)
19. [Current Status & Roadmap](#19-current-status--roadmap)
20. [Glossary](#20-glossary)

---

## 1. What Is Veera? (Plain English)

**Veera** is a mobile fitness app that acts as your **personal AI fitness coach**.

Instead of only counting calories or logging workouts in isolation, Veera brings together:

- **What you eat and drink**
- **How you move** (steps, workouts, sleep)
- **How your body is changing** (weight, InBody scans, measurements)
- **Your goals** (lose fat, build muscle, stay consistent)

… and turns that into **clear daily tips, weekly reviews, monthly reports, achievements, and chat with an AI coach** that understands *your* data.

**Product promise:** *"Your personal AI fitness coach"* — not just a fitness database.

Think of it as combining the best ideas from apps like MyFitnessPal (nutrition), Fitbod/Hevy (workouts), WHOOP/Oura (recovery feel), and Apple Fitness+ (motivation) — with an **AI layer** that reads your progress and tells you what to focus on next.

---

## 2. Who Is It For?

| User type | How they use Veera |
|-----------|----------------------|
| **Gym members** | Log workouts, track diet, upload InBody scans, get AI plans and reviews |
| **Fitness beginners** | Guided onboarding, daily score, simple quick actions on Home |
| **Serious lifters** | Workout sessions, personal records (PRs), progression suggestions |
| **People with InBody access** | Scan/upload reports for clinical-grade body composition analysis |
| **Trainers & gym owners** *(roadmap)* | Member management, scheduling, attendance — schema exists, UI partial |

Veera is especially oriented toward **Indian gym-goers** (regional diet options, local food logging) but works for anyone tracking fitness holistically.

---

## 3. Problems Veera Solves

| Problem | Veera's answer |
|---------|-------------------|
| "I log data but don't know what it means" | AI weekly/monthly reviews + daily coach tip |
| "I lose motivation after a few weeks" | Streaks, achievements, journey map, fitness score |
| "My gym gives me InBody printouts I never use" | Upload scan → AI explains body fat, muscle, visceral fat, recommendations |
| "I don't know what to eat or how to train" | AI diet plans, AI workout plans from InBody + goals |
| "Too many apps for diet, gym, and progress" | One app: Home, Workout, Diet, Progress, AI Coach |

---

## 4. How the App Works — User Journey

### First time opening the app

```
Open app → Onboarding slides → Sign up / Log in → Profile setup (goal, height, weight)
→ Land on Home tab
```

### A typical day

1. **Morning** — Open Home: see Daily Score, coach tip, step/calorie/water rings.
2. **During the day** — Log meals (Diet tab), water, steps sync automatically if enabled.
3. **At the gym** — Start workout from Workout tab, log sets/reps, complete session.
4. **Evening** — Check Progress tab for fitness score, journal charts, achievements.
5. **Weekly** — Open Weekly Review (from Progress or Coach) for AI summary of the week.

### InBody journey

```
InBody tab/screen → Upload photo/PDF or estimate from measurements
→ App reads numbers (OCR) → AI writes full analysis
→ Results feed workout plans, progress charts, transformation timeline
```

---

## 5. Main Features Explained Simply

### Home

Your **command center**. Shows greeting, streak, daily score (0–100), coach tip of the day, quick actions (meal, water, weight, train), activity rings, today's workout, weight trend, and activity timeline.

### Workout

Your **training hub**. AI-generated or manual workout plans, live session logging, rest timer, personal records, workout streak, and progression insights.

### Diet

**Food and hydration tracking**. Log meals, see calories/macros vs goals, AI-generated diet plans based on your profile and InBody data.

### Progress

Your **results dashboard**. Fitness score breakdown, fitness journal (steps/calories/sleep/weight charts), transformation summary from InBody, achievements grid, journey map link, AI insights, weekly review banner.

### Analysis

**Body composition focus**. InBody reports, radar-style fitness dimensions, trends from scans.

### AI Coach (Trainer tab)

**Chat with your coach**. Ask questions; the AI uses your profile, recent logs, and (when wired) latest reviews as context. Replies powered by Groq LLM.

### Coach Reports

- **Daily digest** — One tip + one focus action on Home (refreshes each day).
- **Weekly review** — Score, activity breakdown, AI narrative, forecasts, shareable card.
- **Monthly report** — Longer-horizon analysis, transformation timeline, next-month goals.

### Achievements & Journey

**Gamification**. Badges for streaks, workouts, weight milestones. Journey screen shows stages and unlockable titles.

### Gym *(partial)*

Membership, attendance, trainer booking — backend schema ready; member-facing UI evolving.

---

## 6. App Screens & Navigation

### Bottom tabs (main navigation)

| Tab | Route | Purpose |
|-----|-------|---------|
| Home | `/(tabs)/index` | Daily overview |
| Analysis | `/(tabs)/analysis` | Body comp analytics |
| Workout | `/(tabs)/workout` | Training |
| Progress | `/(tabs)/progress` | Scores, journal, achievements |
| Profile | `/(tabs)/profile` | Settings, profile, achievements |

### Hidden routes (linked from other screens)

| Screen | Route |
|--------|-------|
| Diet | `/(tabs)/diet` |
| AI Coach chat | `/(tabs)/trainer` |
| Gym | `/(tabs)/gym` |

### Deep links / stack screens

| Area | Examples |
|------|----------|
| Auth | `/login`, `/setup`, `/onboarding` |
| InBody | `/inbody`, `/inbody/measurement-wizard` |
| Coach | `/coach/weekly-review`, `/coach/monthly-report`, `/coach/journey` |
| Workout | `/workout/ai-onboarding`, `/workout/weekly-plan` |
| Diet | `/diet/my-plan` |
| Metrics | `/metrics/weight`, `/metrics/steps`, `/metrics/sleep`, etc. |

---

## 7. System Overview (Big Picture)

Veera is a **client–server** application:

```
┌─────────────────┐         HTTPS / JSON          ┌─────────────────┐
│  Mobile App     │  ◄──────────────────────────► │  Backend API    │
│  (Expo/RN)      │         JWT Auth              │  (Express/TS)   │
└─────────────────┘                               └────────┬────────┘
                                                             │
                    ┌────────────────────────────────────────┼────────────────────┐
                    ▼                    ▼                   ▼                    ▼
             ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
             │ PostgreSQL   │   │ Supabase     │   │ Groq AI      │   │ OCR / Vision │
             │ (Supabase)   │   │ Storage      │   │ (LLM)        │   │ (InBody)     │
             └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

**In one sentence:** The phone app collects and displays data; the server stores it, runs business logic, and calls AI services when you need analysis or coaching.

---

## 8. Technical Architecture

### Architectural style

- **Monorepo-style workspace:** `Veera-Frontend/` + `Veera-backend/`
- **REST API** over HTTP (JSON bodies, JWT bearer tokens)
- **Single PostgreSQL database** (no microservices yet)
- **Service layer** on backend — routes are thin, services hold business logic
- **Context + hooks** on frontend — shared state (auth, fitness, achievements)

### Layered backend

```
HTTP Request
    → Route (Express router)
    → Controller (validation, HTTP codes)
    → Service (business logic)
    → Drizzle ORM → PostgreSQL
    → Optional: Groq / Supabase Storage / external APIs
```

### Layered frontend

```
Screen (app/*.tsx)
    → Components (components/*)
    → Hooks (hooks/*) + Context (context/*)
    → API clients (lib/*-api.ts)
    → Backend REST API
```

### Design principles

1. **One source of truth** — Server DB for persistent data; AsyncStorage for auth token cache only.
2. **Reuse over duplicate** — Coach reviews reuse `historyService`, not separate tables.
3. **AI with fallback** — If Groq is unavailable, rule-based narratives still work.
4. **Premium UX** — Rings, gradients, motion, achievements — without changing information architecture.

---

## 9. Frontend Architecture

| Item | Detail |
|------|--------|
| **Framework** | Expo 54 + React Native 0.81 + React 19 |
| **Routing** | Expo Router 6 (file-based, `app/` directory) |
| **State** | React Context (`AuthContext`, `FitnessContext`, `AchievementUnlockContext`) |
| **Server state** | TanStack Query (where used) + custom hooks |
| **Animation** | React Native Reanimated 4 |
| **Styling** | StyleSheet + theme via `useColors()` hook |
| **API base** | `lib/api.ts` → `EXPO_PUBLIC_API_URL` |

### Key frontend folders

| Folder | Role |
|--------|------|
| `app/` | All screens (Expo Router) |
| `components/` | Reusable UI (home, coach, progress, workout, ui) |
| `context/` | Global React state |
| `hooks/` | Data fetching and derived state |
| `lib/` | API clients, utilities, haptics, metrics |
| `constants/` | Colors, animations, energy-glow tokens |

### Important contexts

| Context | Stores |
|---------|--------|
| `AuthContext` | User, JWT token, login/logout/register |
| `FitnessContext` | Today's log, goals, streak, activity, sync |
| `AchievementUnlockContext` | Queue and modal for newly unlocked badges |

---

## 10. Backend Architecture

| Item | Detail |
|------|--------|
| **Runtime** | Node.js 20+ |
| **Framework** | Express 5 |
| **Language** | TypeScript (strict) |
| **ORM** | Drizzle |
| **Build** | esbuild → `dist/index.js` |
| **Entry** | `src/index.ts` |
| **Port** | Default 3000, prefix `/api` |

### Route groups (all under `/api`)

| Mount | Domain |
|-------|--------|
| `/auth` | Register, login, Google OAuth, profile, onboarding |
| `/inbody` | Upload, analyze, list, delete reports |
| `/workout/onboarding` | AI plan generation from InBody |
| `/workouts`, `/exercises` | Sessions, logs, PRs, streaks |
| `/food`, `/diet`, `/hydration`, `/nutrition` | Diet logging and plans |
| `/progress` | Dashboard, check-in, weight, fitness score, history |
| `/chat` | AI trainer threads and replies |
| `/achievements` | List, journey, evaluate triggers |
| `/coach` | Weekly/monthly reviews, daily digest, saved reports |
| `/motivation` | Public quote endpoint |

### Core services

| Service | Responsibility |
|---------|----------------|
| `coachReviewService` | Weekly/monthly/daily coach content, persistence |
| `historyService` | Unified daily buckets (steps, calories, sleep, weight) |
| `forecastService` | Weight/strength forecasts, timeline insight |
| `achievementService` | Evaluate and award achievements |
| `workoutService` | Sessions, completion, streak sync |
| `inbodyService` | Upload, OCR pipeline, AI analysis, storage |
| `dietService` / `dietPlanService` | Logging, targets, AI meal plans |
| `goalRecommendationEngine` | Goal progress and next-week targets |
| `chatService` | AI trainer conversation |

---

## 11. Database Design

**Engine:** PostgreSQL (hosted on Supabase)  
**Migrations:** Drizzle Kit (`Veera-backend/drizzle/`)  
**~75 tables** across **18 schema domains**

### Domain summary

| Domain | Key tables | Purpose |
|--------|------------|---------|
| **Users** | `users`, `user_profiles`, `auth_sessions` | Identity and profile |
| **Workouts** | `exercises`, `user_workout_plans`, `user_workout_sessions`, `exercise_logs`, `personal_records` | Training data |
| **InBody** | `inbody_reports` | Scans, OCR metrics, AI analysis JSON |
| **Analytics** | `weight_logs`, `activity_summaries`, `daily_checkins`, `goals`, `user_streaks`, `achievement_definitions`, `user_achievements` | Progress & gamification |
| **Diet** | `food_items`, `diet_logs`, `water_logs`, `nutrition_targets`, `diet_plans` | Nutrition |
| **AI** | `ai_plan_requests`, `ai_plan_responses` | Coach reviews, digests, plan requests |
| **Gyms** | `gyms`, `gym_membership_plans`, `gym_trainers` | Multi-tenant gym ops |
| **Memberships** | `memberships`, `payments`, `subscription_invoices` | Billing |
| **Attendance** | `check_ins`, `attendance_records` | Gym check-in |
| **Scheduling** | `training_sessions`, `session_bookings` | Trainer bookings |
| **Communications** | `chat_threads`, `chat_messages`, `notifications` | Messaging |
| **Files** | `files`, `file_references` | Generic file metadata |
| **Security / Audit** | `api_keys`, `audit_events`, `failed_login_attempts` | Security |

### Coach data storage (no extra domain tables)

Coach reviews and daily digests are stored in existing AI tables:

- `ai_plan_requests.request_type` = `coach_weekly_review` | `coach_monthly_review` | `coach_daily_digest`
- `ai_plan_responses.response_payload` = full JSON review/digest
- One record per user per period (upsert by week/month/day key)

---

## 12. AI Coach System

### What the AI does

| Feature | Input data | Output |
|---------|------------|--------|
| **Daily digest** | Yesterday's steps, calories, sleep, workouts, streak | Tip + focus action |
| **Weekly review** | 7-day history, goals, achievements, body trends | Score, narrative, drivers, next-week focus |
| **Monthly report** | 30-day aggregates, InBody trends, forecasts | Long-form report + timeline |
| **InBody analysis** | OCR metrics + optional scan text | Structured sections (body fat, muscle, risks, plan) |
| **AI trainer chat** | User message + trainer context bundle | Conversational reply |
| **Workout/diet plans** | Profile, InBody, goals | Structured plan JSON |

### AI provider

- **Groq** (Llama 3.1 / 3.3 models) via `groq-sdk`
- Environment: `GROQ_API_KEY`, optional `GROQ_MODEL`
- **Fallback:** Rule-based templates when API unavailable (`source: "fallback"` vs `"groq"`)

### Coach implementation phases (status)

| Phase | Feature | Status |
|-------|---------|--------|
| 0 | Streak sync, foundation | ✅ Done |
| 1 | Achievement engine | ✅ Done |
| 2 | Weekly review engine | ✅ Done |
| 3 | Forecasts & timeline | ✅ Done |
| 4 | Daily digest + share cards | ✅ Done |
| 5 | Gamification polish | 🟡 Partial |
| 6 | Proactive coach (push, chat context) | ⏳ Pending |
| 7 | Premium review UX | ✅ Done |
| 8 | Daily coach loop | ✅ Done |
| 9 | Achievement share screens | 🟡 Partial |
| 10 | Leaderboards, AI milestones | ⏳ Pending |

---

## 13. Key Data Flows

### Login

```
App → POST /api/auth/login { email, password }
→ Server validates → JWT issued
→ App stores token → GET /api/auth/profile
→ Route to Home or Setup
```

### Complete a workout

```
App → POST /api/workouts/session/start
→ User logs sets → POST /api/workouts/session/log
→ POST /api/workouts/session/complete
→ Server updates streak, activity, triggers achievement evaluate
→ App shows updated streak/score
```

### Upload InBody report

```
App → multipart POST /api/inbody/upload
→ Storage (Supabase) + OCR (Groq Vision → fallbacks)
→ extractMetrics → analyzeWithGemini (Groq)
→ Save inbody_reports row
→ App displays AI analysis; may auto-run if stub data detected
```

### Generate weekly review

```
App → GET /api/coach/weekly-review
→ Server: history + goals + forecasts + Groq narrative
→ Upsert ai_plan_requests/responses
→ Return JSON → CoachReportShell UI
→ Optional: share as PNG via ShareableCoachCard
```

---

## 14. API Reference Summary

Base URL: `{API_HOST}/api`  
Auth header: `Authorization: Bearer <JWT>`

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Email/password login |
| POST | `/auth/login-phone` | Phone OTP login |
| GET | `/auth/profile` | Current user |
| POST | `/auth/logout` | Invalidate session |

### Coach

| Method | Path | Description |
|--------|------|-------------|
| GET | `/coach/daily-digest?refresh=true` | Daily tip (optional force refresh) |
| GET | `/coach/weekly-review` | Weekly review (lazy generate) |
| POST | `/coach/weekly-review/generate` | Force regenerate |
| GET | `/coach/monthly-report` | Monthly report |
| GET | `/coach/reports` | Saved report history |

### InBody

| Method | Path | Description |
|--------|------|-------------|
| POST | `/inbody/upload` | Upload scan (multipart) |
| POST | `/inbody/analyze/:reportId` | Re-run AI analysis |
| GET | `/inbody/reports` | List user reports |
| GET | `/inbody/reports/:id` | Single report detail |

### Progress

| Method | Path | Description |
|--------|------|-------------|
| GET | `/progress/dashboard` | Main dashboard payload |
| GET | `/progress/history?period=week` | Journal buckets |
| GET | `/progress/fitness-score` | Score breakdown |
| POST | `/progress/checkin` | Daily energy/sleep check-in |
| POST | `/progress/weight` | Log weight |

*Full endpoint list: `Veera-backend/README.md`*

---

## 15. Integrations & External Services

| Service | Used for |
|---------|----------|
| **Supabase PostgreSQL** | Primary database |
| **Supabase Auth / OAuth** | Google sign-in |
| **Supabase Storage** | InBody report files (`inbody-reports` bucket) |
| **Groq** | LLM for coach, InBody, chat, plans |
| **Google Cloud Vision** | OCR fallback for InBody |
| **OCR.space** | OCR fallback |
| **ExerciseDB API** | Exercise catalog enrichment |
| **Expo sensors** | Step tracking on device |

---

## 16. Security & Privacy

| Topic | Approach |
|-------|----------|
| **Authentication** | JWT tokens; stored securely on device |
| **Authorization** | User can only access own data (userId checks in services) |
| **Passwords** | Hashed server-side (never stored plain text) |
| **API** | HTTPS in production; CORS configured on backend |
| **Files** | InBody uploads in private Supabase bucket; URLs scoped |
| **AI data** | Prompts include user metrics; no training on user data by Veera code |
| **Secrets** | `.env` files — never committed (`GROQ_API_KEY`, `DATABASE_URL`, etc.) |

---

## 17. Technology Stack

### Frontend

| Technology | Version (approx) |
|------------|----------------|
| Expo | 54 |
| React Native | 0.81 |
| React | 19 |
| Expo Router | 6 |
| TypeScript | 5.x |
| Reanimated | 4 |

### Backend

| Technology | Version (approx) |
|------------|----------------|
| Node.js | 20+ |
| Express | 5 |
| Drizzle ORM | latest |
| TypeScript | 5.x |
| Pino | logging |
| Zod | validation |

---

## 18. Project Structure

```
Veera/
├── docs/
│   ├── Veera_COMPLETE_GUIDE.md      ← This document
│   └── Veera_COMPLETE_GUIDE.html    ← Web-readable version
├── AI_COACH_IMPLEMENTATION_PLAN.md
├── IMPLEMENTATION_PLAN.md
├── Veera-backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── lib/
│   │   └── db/schema/
│   ├── drizzle/
│   └── scripts/
└── Veera-Frontend/
    ├── app/
    ├── components/
    ├── context/
    ├── hooks/
    └── lib/
```

---

## 19. Current Status & Roadmap

### What's working today (June 2026)

- ✅ User auth (email, Google)
- ✅ Home dashboard with daily score, rings, coach tip
- ✅ Workout logging and AI plans
- ✅ Diet and water logging
- ✅ InBody upload + AI analysis
- ✅ Progress dashboard, fitness journal, achievements
- ✅ AI coach chat
- ✅ Weekly/monthly coach reports with forecasts
- ✅ Daily AI digest on Home
- ✅ Shareable coach report cards
- ✅ Achievement unlock flow and journey screen

### In progress / planned

- 🟡 Equip achievement titles on profile
- ⏳ Push notifications when review is ready
- ⏳ Coach chat pre-loaded with latest review
- ⏳ Achievement detail + share screens
- ⏳ Gym leaderboards and social features

---

## 20. Glossary

| Term | Meaning |
|------|---------|
| **InBody** | Professional body composition scanner (weight, body fat %, muscle, visceral fat, BMR) |
| **Daily Score** | 0–100 score from steps, calories, water, sleep, activity |
| **Fitness Score** | Longer-term AI-style score on Progress tab |
| **Streak** | Consecutive days with qualifying activity |
| **PR** | Personal Record — best weight/reps for an exercise |
| **OCR** | Optical Character Recognition — reading text from scan images |
| **Groq** | Cloud AI provider used for fast LLM inference |
| **JWT** | JSON Web Token — secure login session token |
| **Drizzle** | TypeScript ORM mapping code to SQL tables |
| **BMR / TDEE** | Basal Metabolic Rate / Total Daily Energy Expenditure |
| **Digest** | Short daily AI coaching message |
| **Weekly Review** | Structured AI summary of your past 7 days |

---

## Document History

| Date | Change |
|------|--------|
| June 9, 2026 | Initial complete guide (user + system design) |

---

*For backend API details, see [README.md](../README.md) and [BACKEND_TECHNICAL_GUIDE.md](./BACKEND_TECHNICAL_GUIDE.md).  
For frontend details, see [FitTrack-Frontend/docs/FRONTEND_TECHNICAL_GUIDE.md](../../FitTrack-Frontend/docs/FRONTEND_TECHNICAL_GUIDE.md).  
For AI coach technical plan, see [AI_COACH_IMPLEMENTATION_PLAN.md](../../AI_COACH_IMPLEMENTATION_PLAN.md).*
