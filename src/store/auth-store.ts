import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";

import type { UserProfile } from "@/src/types/user";

/**
 * `profileFetchFailed` (story 9-10, AC #3): set when `loadProfile`'s catch
 * path fires — both network and cache reads failed (offline + corrupted
 * cache). The auth guard at `app/_layout.tsx` reads this flag so it can
 * route to a retry surface instead of misrouting an already-onboarded user
 * to `/onboarding`. Cleared on the next successful profile load and on
 * `reset()` (sign-out).
 */
interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isOnboarded: boolean;
  profileFetchFailed: boolean;

  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  setProfileFetchFailed: (failed: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isOnboarded: false,
  profileFetchFailed: false,

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

  setProfileFetchFailed: (failed) => set({ profileFetchFailed: failed }),

  reset: () =>
    set({
      session: null,
      user: null,
      profile: null,
      isLoading: false,
      isOnboarded: false,
      profileFetchFailed: false,
    }),
}));
