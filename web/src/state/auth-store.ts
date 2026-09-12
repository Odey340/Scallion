import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Tracks the current Supabase session (null when signed out or Supabase isn't configured).
 * Callers should sync it to D's typed API client via `api.setToken(session?.access_token ?? null)`
 * (see src/lib/api.ts) so authenticated calls carry the right bearer token.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
