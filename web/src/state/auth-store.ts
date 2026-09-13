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
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? DEMO_TOKEN);
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setToken(nextSession?.access_token ?? DEMO_TOKEN);
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
