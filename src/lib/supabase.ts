import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    return SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
// Prefer the new publishable key (sb_publishable_...); fall back to the legacy
// anon key for a zero-downtime swap. Both go in the same createClient slot and
// use the same low-privilege anon/authenticated Postgres roles + RLS.
// Use an explicit length check (NOT `??`): Expo inlines a blank
// `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` as "" (not undefined), and `??` would
// keep "" — starving createClient — instead of falling back to the anon key.
// Mirrors the Deno resolver's `length > 0` check in `_shared/supabase-keys.ts`.
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseKey = (
  publishableKey && publishableKey.length > 0
    ? publishableKey
    : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
)!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Use SecureStore on native, localStorage on web
    storage: Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // All app tables + RPCs live under the `companion` schema (shared Supabase
  // project). This routes every `.from()`/`.rpc()` call there; `.auth.*` is
  // unaffected (auth always targets the `auth` schema).
  db: { schema: "companion" },
});
