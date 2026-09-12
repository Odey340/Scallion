import { createClient } from '@supabase/supabase-js';

/**
 * Client-side Supabase auth. The API (api/app/auth.py) verifies the JWT Supabase issues;
 * it never issues one itself — C is the one place that has to sign a user in.
 * TODO(human): EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set yet
 * (they live in the team password manager per .env.example, not in the repo). Until they
 * are set as Vercel env vars, `isSupabaseConfigured` is false and the sign-in UI says so
 * instead of silently failing.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
