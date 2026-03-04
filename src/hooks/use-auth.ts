import { useEffect } from "react";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { useProgressStore } from "@/src/store/progress-store";
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
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();

    if (data && !error) {
      setProfile(data as UserProfile);
    }
    setLoading(false);
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
    const { error } = await supabase.auth.signOut();
    if (!error) {
      useAuthStore.getState().reset();
      useProgressStore.getState().reset();
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
        setProfile(upsertData as UserProfile);
      }
      return { data: upsertData, error: upsertError };
    }

    if (data && !error) {
      setProfile(data as UserProfile);
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
