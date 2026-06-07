"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  signInWithGoogle,
} from "@/lib/supabase/client";

export interface AuthSessionState {
  configured: boolean;
  loading: boolean;
  accessToken: string | null;
  user: User | null;
  signIn: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuthSession(): AuthSessionState {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!configured) {
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [configured]);

  return {
    configured,
    loading,
    accessToken: session?.access_token ?? null,
    user: session?.user ?? null,
    signIn: signInWithGoogle,
    signOut: async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await supabase.auth.signOut();
      setSession(null);
    },
  };
}
