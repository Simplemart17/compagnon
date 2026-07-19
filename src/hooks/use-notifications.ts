import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { ANALYTICS_EVENTS, trackEvent } from "@/src/lib/analytics";
import { Colors } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionStatus = "undetermined" | "granted" | "denied";

/**
 * Story 18-3: pure local→UTC hour conversion for the nudge-time preference.
 * `offsetMinutes` is `new Date().getTimezoneOffset()` (minutes WEST of UTC:
 * positive in the Americas, negative east of Greenwich). Fractional-hour
 * timezones (e.g. India +5:30) round to the nearest hour — the nudge window
 * is hour-granular by design. Exported for tests.
 */
export function localHourToUtcHour(localHour: number, offsetMinutes: number): number {
  const utc = Math.round(localHour + offsetMinutes / 60);
  return ((utc % 24) + 24) % 24;
}

/**
 * Story 18-3 R1: pure inverse of `localHourToUtcHour` — maps a stored UTC
 * hour back to the NEAREST local slot (circular distance, wraparound-safe).
 * Exported so tests can pin the round-trip property directly.
 */
export function utcHourToNearestSlot(utcHour: number, offsetMinutes: number): NudgeTimeSlotKey {
  let best: NudgeTimeSlotKey = "evening";
  let bestDist = 24;
  for (const slot of NUDGE_TIME_SLOTS) {
    const slotUtc = localHourToUtcHour(slot.localHour, offsetMinutes);
    const raw = Math.abs(slotUtc - utcHour);
    const dist = Math.min(raw, 24 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.key;
    }
  }
  return best;
}

/** Story 18-3: the three user-facing nudge time slots (local hours). */
export const NUDGE_TIME_SLOTS = [
  { key: "morning", label: "Morning", localHour: 9 },
  { key: "afternoon", label: "Afternoon", localHour: 14 },
  { key: "evening", label: "Evening", localHour: 18 },
] as const;
export type NudgeTimeSlotKey = (typeof NUDGE_TIME_SLOTS)[number]["key"];

interface NotificationPreferences {
  streakAlerts: boolean;
  srsReminders: boolean;
  /** Story 18-3: daily conversation nudge opt-in. */
  dailyNudge: boolean;
}

export interface UseNotificationPreferencesReturn {
  preferences: NotificationPreferences;
  updatePreference: (key: keyof NotificationPreferences, value: boolean) => Promise<void>;
  permissionStatus: PermissionStatus;
  /** Story 18-3: the user's nudge time slot (null until loaded). */
  nudgeSlot: NudgeTimeSlotKey | null;
  updateNudgeSlot: (slot: NudgeTimeSlotKey) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EAS_PROJECT_ID = "ce8862a4-5a0a-4276-8cb6-24faeaee424a";

// ---------------------------------------------------------------------------
// Standalone registration function (called from _layout.tsx)
// ---------------------------------------------------------------------------

export async function registerForPushNotifications(): Promise<void> {
  try {
    let { status } = await Notifications.getPermissionsAsync();

    if (status !== "granted") {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }

    if (status !== "granted") {
      return;
    }

    // Android notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: Colors.primary,
      });
    }

    // Only get push token on physical devices
    if (!Device.isDevice) {
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });

    const { error } = await supabase.functions.invoke("notification-register", {
      body: {
        action: "register",
        token: tokenData.data,
        platform: Platform.OS,
        deviceName: Device.deviceName,
      },
    });

    if (error) throw error;
  } catch (err) {
    captureError(err, "notification-registration");
  }
}

// ---------------------------------------------------------------------------
// Deep link listener setup (called from _layout.tsx)
// ---------------------------------------------------------------------------

export function setupNotificationResponseListener(
  navigate: (path: string) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const screen = response.notification.request.content.data?.screen;
    if (screen === "home") {
      navigate("/(tabs)/home");
    } else if (screen === "vocabulary") {
      navigate("/(tabs)/practice/vocabulary");
    } else if (screen === "conversation") {
      // Story 18-3: daily-nudge tap lands on the conversation hub. Topic
      // pre-seeding from the nudge context is a filed follow-up
      // (18-3-followup-nudge-topic-seed).
      trackEvent(ANALYTICS_EVENTS.NUDGE_OPENED);
      navigate("/(tabs)/conversation");
    }
  });
}

// ---------------------------------------------------------------------------
// Preferences hook (used in settings.tsx only)
// ---------------------------------------------------------------------------

export function useNotificationPreferences(): UseNotificationPreferencesReturn {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("undetermined");
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    streakAlerts: true,
    srsReminders: true,
    dailyNudge: true,
  });
  // Story 18-3: the user's chosen nudge slot, derived from the stored UTC
  // hour on load (nearest slot); null until loaded. The ref mirrors the
  // server-confirmed slot for rollback (same pattern as confirmedPrefsRef).
  const [nudgeSlot, setNudgeSlot] = useState<NudgeTimeSlotKey | null>(null);
  const nudgeSlotRef = useRef<NudgeTimeSlotKey | null>(null);

  // Track server-confirmed state for rollback
  const confirmedPrefsRef = useRef<NotificationPreferences>({
    streakAlerts: true,
    srsReminders: true,
    dailyNudge: true,
  });

  // ---- Check current permission on mount + on foreground resume ----
  const checkPermission = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionStatus(
        status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined"
      );
    } catch (err) {
      captureError(err, "notification-permission-check");
    }
  }, []);

  useEffect(() => {
    void checkPermission();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkPermission();
      }
    });

    return () => subscription.remove();
  }, [checkPermission]);

  // ---- Load preferences on mount ----
  useEffect(() => {
    async function loadPreferences() {
      try {
        const { data, error } = await supabase.functions.invoke("notification-register", {
          body: { action: "get-preferences" },
        });
        if (error) throw error;
        if (data) {
          const loaded = {
            streakAlerts: data.streakAlerts ?? true,
            srsReminders: data.srsReminders ?? true,
            dailyNudge: data.dailyNudge ?? true,
          };
          setPreferences(loaded);
          confirmedPrefsRef.current = loaded;
          // Story 18-3 R1: activation + self-healing resync.
          // - nudgeUtcHour NULL means "not yet activated" (the schema ships
          //   no UTC default — a fixed default would push APAC users at
          //   1-3 AM local). Activate with the evening-LOCAL default now
          //   that the device timezone is known.
          // - When a stored hour exists but no longer matches its nearest
          //   slot's CURRENT UTC hour (DST shift, travel), write the
          //   corrected hour + offset back so display and delivery re-align.
          const offset = new Date().getTimezoneOffset();
          if (typeof data.nudgeUtcHour === "number") {
            const best = utcHourToNearestSlot(data.nudgeUtcHour, offset);
            setNudgeSlot(best);
            nudgeSlotRef.current = best;
            const bestSlot = NUDGE_TIME_SLOTS.find((sl) => sl.key === best);
            const expectedUtc = bestSlot
              ? localHourToUtcHour(bestSlot.localHour, offset)
              : data.nudgeUtcHour;
            if (expectedUtc !== data.nudgeUtcHour) {
              void supabase.functions
                .invoke("notification-register", {
                  body: {
                    action: "preferences",
                    nudgeUtcHour: expectedUtc,
                    tzOffsetMinutes: offset,
                  },
                })
                .catch((err) => captureError(err, "notification-update-preference"));
            }
          } else {
            const evening = NUDGE_TIME_SLOTS[2];
            const eveningUtc = localHourToUtcHour(evening.localHour, offset);
            setNudgeSlot(evening.key);
            nudgeSlotRef.current = evening.key;
            void supabase.functions
              .invoke("notification-register", {
                body: {
                  action: "preferences",
                  nudgeUtcHour: eveningUtc,
                  tzOffsetMinutes: offset,
                },
              })
              .catch((err) => captureError(err, "notification-update-preference"));
          }
        }
      } catch (err) {
        captureError(err, "notification-load-preferences");
      }
    }
    void loadPreferences();
  }, []);

  // ---- Update a single preference ----
  const updatePreference = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      // Snapshot server-confirmed state for rollback
      const rollback = { ...confirmedPrefsRef.current };
      // Optimistic update
      setPreferences((prev) => ({ ...prev, [key]: value }));

      try {
        const { error } = await supabase.functions.invoke("notification-register", {
          body: { action: "preferences", [key]: value },
        });
        if (error) throw error;
        // Update confirmed state on success
        confirmedPrefsRef.current = { ...confirmedPrefsRef.current, [key]: value };
      } catch (err) {
        // Revert to last server-confirmed state
        setPreferences(rollback);
        captureError(err, "notification-update-preference");
        throw err; // Re-throw so caller can show error toast
      }
    },
    []
  );

  // Story 18-3: persist a nudge time slot (converted to UTC client-side —
  // timezone math stays on the client per the Story 9-2 precedent).
  const updateNudgeSlot = useCallback(async (slotKey: NudgeTimeSlotKey) => {
    const slot = NUDGE_TIME_SLOTS.find((sl) => sl.key === slotKey);
    if (!slot) return;
    setNudgeSlot(slotKey);
    try {
      const offset = new Date().getTimezoneOffset();
      const utcHour = localHourToUtcHour(slot.localHour, offset);
      const { error } = await supabase.functions.invoke("notification-register", {
        body: { action: "preferences", nudgeUtcHour: utcHour, tzOffsetMinutes: offset },
      });
      if (error) throw error;
      nudgeSlotRef.current = slotKey;
    } catch (err) {
      // R1: roll back to the LATEST server-confirmed slot at catch time —
      // a pre-await snapshot goes stale under overlapping taps and would
      // desync the UI from the server permanently.
      setNudgeSlot(nudgeSlotRef.current);
      captureError(err, "notification-update-preference");
      throw err;
    }
  }, []);

  return {
    preferences,
    updatePreference,
    permissionStatus,
    nudgeSlot,
    updateNudgeSlot,
  };
}
