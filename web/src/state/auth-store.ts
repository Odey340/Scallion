import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Tracks the current Supabase session (null when signed out or Supabase isn't configured). */
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

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/** Calls the FastAPI backend with the user's Supabase JWT attached. */
export async function apiFetch(path: string, session: Session, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) {
    throw new Error('EXPO_PUBLIC_API_URL is not set');
  }
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}
