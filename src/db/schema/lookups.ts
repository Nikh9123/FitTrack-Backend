import { pgEnum } from "drizzle-orm/pg-core";

export const roleType = pgEnum("role_type", [
  "member",
  "trainer",
  "owner",
  "staff",
  "admin",
]);

export const userStatus = pgEnum("user_status", [
  "pending",
  "active",
  "suspended",
  "banned",
  "deleted",
]);

export const authTokenType = pgEnum("auth_token_type", [
  "password_reset",
  "email_verification",
  "mfa_recovery",
]);

export const authTokenStatus = pgEnum("auth_token_status", [
  "pending",
  "used",
  "expired",
]);

export const mfaType = pgEnum("mfa_type", ["totp", "sms", "authenticator_app"]);

export const gymStatus = pgEnum("gym_status", ["active", "inactive", "suspended", "deleted"]);

export const locationStatus = pgEnum("location_status", ["active", "inactive", "closed"]);

export const accessPointType = pgEnum("access_point_type", ["entrance", "exit", "counter", "turnstile"]);

export const checkinType = pgEnum("checkin_type", ["check_in", "check_out"]);

export const checkinStatus = pgEnum("checkin_status", ["success", "failed", "pending"]);

export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "cancelled"]);

export const paymentMethodType = pgEnum("payment_method_type", ["card", "upi", "wallet", "netbanking", "auto_debit"]);

export const paymentStatus = pgEnum("payment_status", ["pending", "completed", "failed", "refunded", "disputed"]);

export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "paid", "overdue", "cancelled"]);

export const membershipStatus = pgEnum("membership_status", ["pending", "active", "paused", "cancelled", "expired"]);

export const planStatus = pgEnum("plan_status", ["draft", "active", "inactive", "archived"]);

export const bookingStatus = pgEnum("booking_status", ["confirmed", "pending", "cancelled", "checked_in", "completed", "no_show"]);

export const sessionStatus = pgEnum("session_status", ["scheduled", "active", "completed", "cancelled", "no_show"]);

export const trainingStatus = pgEnum("training_status", ["scheduled", "in_progress", "completed", "cancelled", "missed"]);

export const difficultyLevel = pgEnum("difficulty_level", ["beginner", "intermediate", "advanced", "expert"]);

export const fitnessLevel = pgEnum("fitness_level", ["beginner", "intermediate", "advanced"]);

export const workoutSessionStatus = pgEnum("workout_session_status", ["planned", "in_progress", "completed", "skipped"]);

export const dietGoal = pgEnum("diet_goal", ["weight_loss", "maintenance", "muscle_gain", "fat_loss"]);

export const dietPlanStatus = pgEnum("diet_plan_status", ["draft", "active", "paused", "completed", "cancelled"]);

export const dietMealTime = pgEnum("diet_meal_time", ["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]);

export const progressPhotoType = pgEnum("progress_photo_type", ["front", "side", "back", "other"]);

export const privacyLevel = pgEnum("privacy_level", ["private", "gym_visible", "trainer_visible", "public"]);

export const achievementType = pgEnum("achievement_type", ["attendance", "workout", "nutrition", "streak", "milestone"]);

export const streakType = pgEnum("streak_type", ["workout", "checkin", "diet", "hydration"]);

export const notificationType = pgEnum("notification_type", ["system", "reminder", "promotion", "trainer_message", "support"]);

export const notificationChannel = pgEnum("notification_channel", ["push", "in_app", "email", "sms"]);

export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "delivered", "seen", "failed"]);

export const chatThreadType = pgEnum("chat_thread_type", ["trainer_chat", "support_chat", "system_chat"]);

export const chatStatus = pgEnum("chat_status", ["open", "closed", "archived"]);

export const messageType = pgEnum("message_type", ["text", "image", "video", "file", "system"]);

export const messageStatus = pgEnum("message_status", ["sent", "delivered", "read", "failed"]);

export const supportPriority = pgEnum("support_priority", ["low", "medium", "high", "critical"]);

export const supportStatus = pgEnum("support_status", ["open", "pending", "resolved", "closed"]);

export const fileType = pgEnum("file_type", ["image", "document", "report", "receipt", "other"]);

export const fileEntityType = pgEnum("file_entity_type", ["progress_photo", "inbody_report", "receipt", "chat_attachment", "support_attachment"]);

export const auditAction = pgEnum("audit_action", ["create", "update", "delete", "login", "logout", "permission_change", "payment", "system"]);

export const appEventType = pgEnum("app_event_type", ["app_open", "workout_logged", "meal_logged", "checkin", "chat_message", "goal_updated", "payment_made"]);

export const platformSource = pgEnum("platform_source", ["mobile", "web", "api", "kiosk"]);

export const apiKeyStatus = pgEnum("api_key_status", ["active", "inactive", "revoked"]);

export const promotionType = pgEnum("promotion_type", ["percentage", "fixed_amount", "trial", "free_month"]);

export const promotionStatus = pgEnum("promotion_status", ["active", "expired", "draft", "disabled"]);

export const trainerStatus = pgEnum("trainer_status", ["active", "inactive"]);

export const bookingSource = pgEnum("booking_source", ["mobile", "web", "trainer", "admin"]);

export const paymentAuditType = pgEnum("payment_audit_type", ["created", "authorized", "captured", "refunded", "failed", "disputed"]);

export const goalType = pgEnum("goal_type", ["weight", "body_fat", "muscle_mass", "hydration", "calories", "macros"]);

export const goalStatus = pgEnum("goal_status", ["active", "completed", "cancelled", "expired"]);

export const billingCycleType = pgEnum("billing_cycle_type", ["monthly", "quarterly", "annual"]);

export const variationType = pgEnum("variation_type", ["alternative", "progression", "regression"]);

export const aiRequestType = pgEnum("ai_request_type", ["workout_plan", "diet_plan", "recommendation"]);

export const aiRequestStatus = pgEnum("ai_request_status", ["queued", "processing", "completed", "failed"]);

export const pushPlatform = pgEnum("push_platform", ["ios", "android"]);

export const errorSeverity = pgEnum("error_severity", ["low", "medium", "high", "critical"]);
export const activitySourceType = pgEnum("activity_source_type", ["phone_sensors", "google_fit", "apple_health", "fitbit", "garmin", "manual"]);
export const deviceConnectionStatus = pgEnum("device_connection_status", ["connected", "disconnected", "revoked", "expired"]);
