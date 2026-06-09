-- Extend ai_request_type for AI Coach review persistence (Phase 0)
ALTER TYPE "ai_request_type" ADD VALUE IF NOT EXISTS 'coach_daily_digest';
ALTER TYPE "ai_request_type" ADD VALUE IF NOT EXISTS 'coach_weekly_review';
ALTER TYPE "ai_request_type" ADD VALUE IF NOT EXISTS 'coach_monthly_review';
ALTER TYPE "ai_request_type" ADD VALUE IF NOT EXISTS 'coach_forecast';
