import { Router } from "express";
import {
  comparePassword,
  completeOnboarding,
  createJwtToken,
  createUserWithProfile,
  findUserByEmail,
  findUserByPhone,
  findUserByUsername,
  findUserById,
  hashPassword,
  normalizeRole,
  requireAuth,
  toPublicUser,
  supabase,
  logger,
  updateUserProfile,
  deleteUserAccount,
  type AuthenticatedRequest,
  type OnboardingPayload,
} from "../lib/auth";

const router = Router();

// ─── Email/Password Register ──────────────────────────────────────────────────
router.post("/auth/register", async (req, res) => {
  const { email, username, password, role } = req.body;

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  
  if (username && typeof username !== "string") {
    return res.status(400).json({ error: "Username must be a string" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = normalizeRole(role);
  const normalizedUsername = username?.trim().toLowerCase();

  const existingEmail = await findUserByEmail(normalizedEmail);
  if (existingEmail) {
    const provider = (existingEmail.user as any).authProvider ?? "email";
    logger.warn({ email: normalizedEmail, provider }, "Register attempt for existing email");
    if (provider && provider !== "email") {
      return res.status(409).json({ error: `An account already exists using ${provider}. Please sign in with ${provider}.` });
    }
    return res.status(409).json({ error: "An account with this email already exists. Try signing in or use password reset." });
  }
  
  if (normalizedUsername) {
    const existingUsername = await findUserByUsername(normalizedUsername);
    if (existingUsername) {
      return res.status(409).json({ error: "This username is already taken. Please choose another." });
    }
  }

  const passwordHash = await hashPassword(password);
  const user = await createUserWithProfile({
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash,
    role: normalizedRole,
    authProvider: "email",
  });

  // Fetch full row with profile for response
  const row = await findUserById(user.id);
  const token = createJwtToken(user, false);

  logger.info({ userId: user.id, email: normalizedEmail, username: normalizedUsername, role: normalizedRole }, "New user registered");
  return res.status(201).json({ token, user: toPublicUser(row!.user, row!.profile) });
});

// ─── Email/Password Login ─────────────────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const row = await findUserByEmail(normalizedEmail);

    if (!row) {
      // Uniform error — don't reveal whether email exists
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const { user, profile } = row;

    if (!user.passwordHash) {
      // Account was created via Google/SSO — no password set
      return res.status(401).json({
        error: "This account uses Google sign-in. Please continue with Google.",
      });
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      logger.warn({ email: normalizedEmail }, "Login failed: invalid password");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const onboardingCompleted = profile?.onboardingCompleted ?? false;
    const token = createJwtToken(user, onboardingCompleted);

    logger.info({ userId: user.id, email: normalizedEmail }, "Email login successful");
    return res.json({ token, user: toPublicUser(user, profile) });
  } catch (err: any) {
    logger.error({ err }, "Login error");
    return res.status(500).json({ error: "Internal server error", details: err?.message });
  }
});

// ─── Phone OTP Login ──────────────────────────────────────────────────────────
router.post("/auth/login-phone", async (req, res) => {
  const { phone, otp } = req.body;

  if (typeof phone !== "string" || typeof otp !== "string") {
    return res.status(400).json({ error: "Phone number and OTP are required" });
  }

  const normalizedPhone = phone.trim();
  if (normalizedPhone.length < 8) {
    return res.status(400).json({ error: "Enter a valid phone number" });
  }
  if (otp.trim().length < 4) {
    return res.status(400).json({ error: "Enter a valid OTP" });
  }

  let row = await findUserByPhone(normalizedPhone);

  if (!row) {
    // Auto-create account for phone-based new users
    const user = await createUserWithProfile({
      phone: normalizedPhone,
      role: "member",
      authProvider: "phone",
    });
    row = await findUserById(user.id);
    logger.info({ userId: user.id, phone: normalizedPhone }, "New user created via phone");
  }

  const { user, profile } = row!;
  const onboardingCompleted = profile?.onboardingCompleted ?? false;
  const token = createJwtToken(user, onboardingCompleted);

  logger.info({ userId: user.id, phone: normalizedPhone }, "Phone login successful");
  return res.json({ token, user: toPublicUser(user, profile) });
});

// ─── Google OAuth — get redirect URL ─────────────────────────────────────────
// Mobile calls this to get the Supabase-generated Google OAuth URL.
// The redirect goes to Supabase, then Supabase redirects to the app's deep link.
router.post("/auth/google/url", async (req, res) => {
  const { redirectTo } = req.body;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo as string || "fittrack://auth/callback",
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    logger.error({ error: error.message }, "Failed to generate Google OAuth URL");
    return res.status(500).json({ error: "Failed to initiate Google sign-in" });
  }

  return res.json({ url: data.url });
});

// ─── Google OAuth Callback — exchange Supabase session for app JWT ────────────
// After Google redirects, the mobile app extracts the access_token from the URL
// and sends it here to get a FitTrack JWT.
router.post("/auth/google/callback", async (req, res) => {
  const { accessToken, refreshToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: "Supabase access token is required" });
  }

  // Verify the Supabase token and get the user
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken ?? "",
  });

  if (sessionError || !sessionData.user) {
    logger.error({ error: sessionError?.message }, "Invalid Supabase session from Google");
    return res.status(401).json({ error: "Invalid Google session" });
  }

  const supaUser = sessionData.user;
  const email = supaUser.email;

  if (!email) {
    return res.status(400).json({ error: "Google account does not have an email address" });
  }

  // Find existing account or create new one
  let row = await findUserByEmail(email);
  let isNewUser = false;

  if (!row) {
    isNewUser = true;
    const fullName: string = supaUser.user_metadata?.full_name ?? "";
    const [firstName, ...rest] = fullName.split(" ");
    const lastName = rest.join(" ");

    const user = await createUserWithProfile({
      email: email.trim().toLowerCase(),
      role: "member",
      firstName: firstName || "",
      lastName: lastName || "",
      avatarUrl: supaUser.user_metadata?.avatar_url ?? null,
      authProvider: "google",
    });

    row = await findUserById(user.id);
    logger.info({ userId: user.id, email }, "New user created via Google OAuth");
  } else {
    // Update avatar from Google if not set
    if (!row.profile?.avatarUrl && supaUser.user_metadata?.avatar_url) {
      const { db, userProfiles } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      await db
        .update(userProfiles)
        .set({ avatarUrl: supaUser.user_metadata.avatar_url })
        .where(eq(userProfiles.userId, row.user.id));
      row = await findUserById(row.user.id);
    }
  }

  const { user, profile } = row!;
  const onboardingCompleted = profile?.onboardingCompleted ?? false;
  const token = createJwtToken(user, onboardingCompleted);

  logger.info({ userId: user.id, email, isNewUser }, "Google OAuth login successful");
  return res.json({
    token,
    user: toPublicUser(user, profile),
    isNewUser,
  });
});

// ─── Get current user ─────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const authUser = req.auth!;
  const row = await findUserById(authUser.sub);

  if (!row) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({ user: toPublicUser(row.user, row.profile) });
});

// ─── Update profile / settings ───────────────────────────────────────────────
router.patch("/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;
  const { firstName, lastName, avatarUrl, phone, preferences } = req.body;

  logger.info({ userId }, "Profile update requested");

  try {
    const row = await updateUserProfile(userId, { firstName, lastName, avatarUrl, phone, preferences });
    logger.info({ userId }, "Profile updated successfully");
    return res.json({ user: toPublicUser(row!.user, row!.profile) });
  } catch (err) {
    logger.error({ err, userId }, "Profile update failed");
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

// ─── Delete account (soft delete) ────────────────────────────────────────────
router.delete("/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;

  logger.info({ userId }, "Account deletion requested");

  try {
    await deleteUserAccount(userId);
    logger.info({ userId }, "Account marked as deleted");
    return res.status(204).send();
  } catch (err) {
    logger.error({ err, userId }, "Account deletion failed");
    return res.status(500).json({ error: "Failed to delete account" });
  }
});

// ─── Complete Onboarding ──────────────────────────────────────────────────────
router.post("/auth/onboarding", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;
  const payload: OnboardingPayload = req.body;

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Onboarding data is required" });
  }

  await completeOnboarding(userId, payload);

  const row = await findUserById(userId);
  const onboardingCompleted = true;
  const token = createJwtToken(row!.user, onboardingCompleted);

  logger.info({ userId }, "Onboarding completed");
  return res.json({ token, user: toPublicUser(row!.user, row!.profile) });
});

// ─── Get full profile (fresh from DB) ───────────────────────────────────────
// Use this when you need guaranteed-fresh data (e.g. after profile edit).
router.get("/auth/profile", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;
  const row = await findUserById(userId);

  if (!row) {
    return res.status(404).json({ error: "User not found" });
  }

  logger.info({ userId }, "Profile fetched");
  return res.json({ user: toPublicUser(row.user, row.profile) });
});

// ─── Logout ───────────────────────────────────────────────────────────────────
// Stateless JWT — the client drops the token. For refresh-token revocation,
// insert the jti into a token-blacklist table here in the future.
router.post("/auth/logout", requireAuth, async (req: AuthenticatedRequest, res) => {
  logger.info({ userId: req.auth!.sub }, "User logged out");
  return res.json({ success: true });
});

export default router;
