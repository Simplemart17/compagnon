import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";

import type { UserProfile } from "@/src/types/user";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isOnboarded: boolean;

  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isOnboarded: false,

  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
    }),

  setProfile: (profile) =>
    set({
      profile,
      isOnboarded: profile?.onboarding_completed ?? false,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  reset: () =>
    set({
      session: null,
      user: null,
      profile: null,
      isLoading: false,
      isOnboarded: false,
    }),
}));
