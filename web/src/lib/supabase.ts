import { createClient } from '@supabase/supabase-js';

/**
 * Client-side Supabase auth. The API (api/app/auth.py) verifies the JWT Supabase issues;
 * it never issues one itself — C is the one place that has to sign a user in.
 * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are Vercel env vars (production + preview).
 * `detectSessionInUrl` is on by default in the browser, so returning from the emailed link
 * (see onboarding.tsx's emailRedirectTo) establishes the session with no extra code.
 *
 * Project-side config (done 2026-09-12 via the Management API, see docs/log/C.md session 15):
 * Site URL https://scallion.us, redirect allowlist incl. Vercel previews + localhost, custom SMTP
 * through Resend from signin@scallion.us, 60 auth emails/hour, 6-digit codes, and an email
 * template that carries both {{ .Token }} and {{ .ConfirmationURL }} so typing the code and
 * clicking the link both work.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
