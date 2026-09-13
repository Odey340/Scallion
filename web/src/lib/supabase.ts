import { createClient } from '@supabase/supabase-js';

/**
 * Client-side Supabase auth. The API (api/app/auth.py) verifies the JWT Supabase issues;
 * it never issues one itself — C is the one place that has to sign a user in.
 * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are set as Vercel env vars.
 * `detectSessionInUrl` is on by default in the browser, so returning from the magic-link
 * email (see onboarding.tsx's emailRedirectTo) establishes the session with no extra code.
 * TODO(human): the Supabase project's Auth -> URL Configuration must list this app's real
 * origin (https://scallion.us) as the Site URL and in the Redirect URLs allowlist, or the
 * emailed link falls back to Supabase's default Site URL instead — that's the localhost
 * redirect bug. Requires dashboard access; not something the anon key can change.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
