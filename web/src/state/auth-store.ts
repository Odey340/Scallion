import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { setToken } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const DEMO_TOKEN = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? null;

/**
 * Tracks the current Supabase session (null when signed out or Supabase isn't configured) and
 * keeps D's typed API client (src/lib/api.ts) pointed at the right bearer: the real session's
 * access token, else the shared demo account's EXPO_PUBLIC_DEMO_TOKEN, else nothing.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    const client = supabase;
    if (!client) {
      return;
    }

    client.auth.getSession().then(async ({ data }) => {
      let current = data.session;
      if (current) {
        // Re-mint the access token on every load. The project's JWT signing key was rotated
        // (ES256 -> the legacy HS256 secret api/app/auth.py verifies) on 2026-09-13; sessions
        // established before that carry a token the API rejects until refreshed. Cheap, and it
        // also keeps a returning tab from presenting a nearly-expired token.
        const { data: refreshed } = await client.auth.refreshSession();
        if (refreshed.session) current = refreshed.session;
      }
      setToken(current?.access_token ?? DEMO_TOKEN);
      setSession(current);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setToken(nextSession?.access_token ?? DEMO_TOKEN);
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
