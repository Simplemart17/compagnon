import { useEffect } from "react";

import {
  cacheWithFallback,
  invalidateCache,
  clearUserCache,
  flushWriteQueue,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/src/lib/cache";
import { captureError } from "@/src/lib/sentry";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import type { UserProfile } from "@/src/types/user";

/** Initialize auth listener and load user profile */
export function useAuth() {
  const { session, user, profile, isLoading, isOnboarded, setSession, setProfile, setLoading } =
    useAuthStore();

  useEffect(() => {
    // Get initial session
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        void loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        void loadProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(userId: string) {
    try {
      const { data: profile } = await cacheWithFallback<UserProfile | null>(
        userId,
        CACHE_KEYS.PROFILE,
        async () => {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
          if (error) throw error;
          return data as UserProfile;
        },
        CACHE_TTL.PROFILE
      );

      if (profile) {
        setProfile(profile);
      }

      // Flush any queued writes now that we have connectivity
      void flushWriteQueue(supabase);
    } catch (err) {
      // Expected degradation: both network and cache failed (e.g. offline cold start).
      // Only send to Sentry for unexpected errors, not routine network failures.
      const isNetworkError =
        err instanceof Error && /network|fetch|failed to fetch|offline/i.test(err.message);
      if (!isNetworkError) {
        captureError(err, "auth-load-profile");
      }
    } finally {
      setLoading(false);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }

  async function signUpWithEmail(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    return { data, error };
  }

  async function signOut() {
    const userId = user?.id;
    const { error } = await supabase.auth.signOut();
    if (!error) {
      if (userId) {
        void clearUserCache(userId);
      }
      useAuthStore.getState().reset();
    }
    return { error };
  }

  async function updateProfile(updates: Partial<UserProfile>) {
    if (!user) return { error: new Error("Not authenticated") };

    const { data, error } = await supabase
      .from("profiles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single();

    // If update found no row (profile wasn't created by trigger), upsert instead
    if (error && !data) {
      const { data: upsertData, error: upsertError } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: user.user_metadata?.full_name ?? null,
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (upsertData && !upsertError) {
        const updatedProfile = upsertData as UserProfile;
        setProfile(updatedProfile);
        void invalidateCache(user.id, CACHE_KEYS.PROFILE);
      }
      return { data: upsertData, error: upsertError };
    }

    if (data && !error) {
      const updatedProfile = data as UserProfile;
      setProfile(updatedProfile);
      void invalidateCache(user.id, CACHE_KEYS.PROFILE);
    }
    return { data, error };
  }

  return {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
  };
}
