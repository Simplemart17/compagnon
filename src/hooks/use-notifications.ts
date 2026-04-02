import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { Colors } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionStatus = "undetermined" | "granted" | "denied";

interface NotificationPreferences {
  streakAlerts: boolean;
  srsReminders: boolean;
}

export interface UseNotificationPreferencesReturn {
  preferences: NotificationPreferences;
  updatePreference: (key: keyof NotificationPreferences, value: boolean) => Promise<void>;
  permissionStatus: PermissionStatus;
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
  });

  // Track server-confirmed state for rollback
  const confirmedPrefsRef = useRef<NotificationPreferences>({
    streakAlerts: true,
    srsReminders: true,
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
          };
          setPreferences(loaded);
          confirmedPrefsRef.current = loaded;
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

  return {
    preferences,
    updatePreference,
    permissionStatus,
  };
}
