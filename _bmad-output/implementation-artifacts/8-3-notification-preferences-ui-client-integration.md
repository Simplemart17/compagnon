# Story 8.3: Notification Preferences UI & Client Integration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner who wants control over notifications,
I want to grant notification permissions, register my device, and manage my notification preferences,
So that I receive only the reminders I want and can opt out at any time.

## Acceptance Criteria

### 1. Install & Configure `expo-notifications`

- [ ] `expo-notifications` added to `package.json` via `npx expo install expo-notifications`
- [ ] `app.json` `plugins` array includes `expo-notifications` configuration:
  ```json
  [
    "expo-notifications",
    {
      "icon": "./assets/images/notification-icon.png",
      "color": "#1E3A5F"
    }
  ]
  ```
  (icon file optional — can use default; color matches `Colors.primary`)
- [ ] `npm run type-check` passes clean after installation

**Given** the `expo-notifications` dependency
**When** added to the project
**Then** `package.json` and `package-lock.json` are updated
**And** the `app.json` plugins array includes the `expo-notifications` configuration

### 2. Push Token Registration Hook — `use-notifications.ts`

- [ ] File: `src/hooks/use-notifications.ts`
- [ ] Exports `useNotifications()` hook with:
  - `registerForPushNotifications()` — requests permission, gets Expo push token, registers via Edge Function
  - `preferences: { streakAlerts: boolean; srsReminders: boolean }` — current notification preferences state
  - `updatePreference(key: 'streakAlerts' | 'srsReminders', value: boolean)` — toggle a single preference
  - `permissionStatus: 'undetermined' | 'granted' | 'denied'` — current OS-level notification permission
  - `isRegistering: boolean` — loading state during token registration
- [ ] `registerForPushNotifications()` flow:
  1. Call `Notifications.getPermissionsAsync()` — check current status
  2. If not `granted`, call `Notifications.requestPermissionsAsync()`
  3. If granted, call `Notifications.getExpoPushTokenAsync({ projectId: 'ce8862a4-5a0a-4276-8cb6-24faeaee424a' })`
  4. Call `notification-register` Edge Function with `{ action: 'register', token, platform: Platform.OS, deviceName: Device.deviceName }`
  5. On success, update local `permissionStatus` state to `'granted'`
  6. On permission denied, set `permissionStatus` to `'denied'` — no error shown
- [ ] `loadPreferences()` — called on mount, fetches current preferences via `{ action: 'get-preferences' }` from Edge Function
- [ ] `updatePreference()` — calls `{ action: 'preferences', [key]: value }` on Edge Function, updates local state optimistically

**Given** a user logging in on a device for the first time
**When** authentication succeeds
**Then** the app requests push notification permission via `expo-notifications`
**And** if granted, the push token is registered via the `notification-register` Edge Function
**And** if denied, the app continues without notifications and no error is shown

**Given** the `useNotifications()` hook
**When** mounted
**Then** it loads current preferences from the Edge Function
**And** exposes `preferences`, `permissionStatus`, `updatePreference`, and `registerForPushNotifications`

### 3. Auto-Registration on Auth

- [ ] In `app/_layout.tsx` (or a dedicated `NotificationProvider` component), call `registerForPushNotifications()` when user session is established (non-null session from `useAuth()`)
- [ ] Registration runs once per app launch when authenticated — NOT on every re-render
- [ ] Use `useEffect` with session dependency: `if (session) { registerForPushNotifications(); }`
- [ ] Silent failure: if permission denied or network error, do not block app usage

**Given** a user who logs in
**When** the session is established
**Then** `registerForPushNotifications()` runs automatically in the background
**And** failure does not block app functionality

**Given** a user who logs out
**When** the session ends
**Then** the device push token is NOT deregistered (user may log back in on same device)

### 4. Notification Preferences in Settings

- [ ] In `app/(tabs)/profile/settings.tsx`, add a "Notifications" section between "Compte" and "Donnees" sections
- [ ] Section uses the existing `SectionLabel` + `SettingsCard` + `CardLabel` helper components
- [ ] Section label: "Notifications"
- [ ] Contains two toggle rows:
  - "Streak Reminders" (maps to `streakAlerts`) — default on
  - "Vocabulary Review Reminders" (maps to `srsReminders`) — default on
- [ ] Each row: label text on the left, React Native `Switch` component on the right
- [ ] `Switch` uses `trackColor={{ false: Colors.gray300, true: Colors.primary }}` and `thumbColor={Colors.white}`
- [ ] Changes saved immediately on toggle via `updatePreference()` — no confirmation dialog needed (low severity, easily reversible)
- [ ] Success toast: "Notification preference updated" via `useToast()`
- [ ] Error toast on failure: "Failed to update preference" via `useToast()`
- [ ] If `permissionStatus === 'denied'`, show an "Enable Notifications" row that opens device settings via `Linking.openSettings()`
  - Row text: "Enable Notifications"
  - Subtitle: "Companion needs notification access for streak and vocabulary reminders"
  - Tapping opens OS settings with `Linking.openSettings()`

**Given** an authenticated user in the settings screen
**When** they view notification preferences
**Then** they see toggles for "Streak Reminders" (default on) and "Vocabulary Review Reminders" (default on)
**And** changes are saved immediately to the `notification-register` Edge Function

**Given** a user toggling a notification preference off
**When** the toggle is switched
**Then** the preference updates without a confirmation dialog
**And** a success toast confirms: "Notification preference updated"

**Given** a user who previously denied notification permissions
**When** they navigate to notification preferences in settings
**Then** an "Enable Notifications" option links to device settings

### 5. Deep Linking from Notifications

- [ ] Configure notification response handler in `app/_layout.tsx` or the notifications hook
- [ ] When a notification with `data: { screen: "home" }` is tapped, navigate to home tab
- [ ] When a notification with `data: { screen: "vocabulary" }` is tapped, navigate to vocabulary screen
- [ ] Use `Notifications.addNotificationResponseReceivedListener()` for handling taps
- [ ] Use `router.replace()` from `expo-router` for navigation

**Given** a streak notification with `data: { screen: "home" }`
**When** tapped
**Then** the app opens to the home screen

**Given** an SRS notification with `data: { screen: "vocabulary" }`
**When** tapped
**Then** the app opens to the vocabulary review screen

### 6. New Device Registration

- [ ] When a user logs in on a new device, the auto-registration (AC #3) handles registering the new device token
- [ ] Old tokens from inactive devices are cleaned up server-side when push delivery fails (already implemented in story 8-2)
- [ ] Multiple device tokens per user are supported by the `device_tokens` table schema (UNIQUE on user_id + token, not on user_id alone)

**Given** a user who logs in on a new device
**When** authentication succeeds
**Then** the new device token is registered alongside any existing tokens for that user

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex
- [ ] All loading states use skeleton animations — no `ActivityIndicator` spinners
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel`
- [ ] Non-obvious interactions have `accessibilityHint`
- [ ] Stateful elements have `accessibilityState`
- [ ] All tappable elements have minimum 44x44pt touch targets
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`
- [ ] All text uses `Typography.*` presets — no raw pixel `fontSize`
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Install `expo-notifications` and configure `app.json` (AC: #1)
  - [x] 1.1 Run `npx expo install expo-notifications expo-device`
  - [x] 1.2 Add `expo-notifications` to `app.json` plugins array
  - [x] 1.3 Verify `npm run type-check` passes clean
- [x] Task 2: Create `use-notifications.ts` hook (AC: #2, #5)
  - [x] 2.1 Create `src/hooks/use-notifications.ts`
  - [x] 2.2 Implement `registerForPushNotifications()` — permission request → get token → register via Edge Function
  - [x] 2.3 Implement `loadPreferences()` — fetch current preferences from `notification-register` Edge Function (`get-preferences` action)
  - [x] 2.4 Implement `updatePreference(key, value)` — call `preferences` action on Edge Function, update local state optimistically, revert on failure
  - [x] 2.5 Implement `permissionStatus` state tracking — check on mount via `getPermissionsAsync()`
  - [x] 2.6 Implement notification response listener — `addNotificationResponseReceivedListener` with `router.replace()` for deep linking
- [x] Task 3: Wire auto-registration on auth (AC: #3, #6)
  - [x] 3.1 In `app/_layout.tsx`, call `registerForPushNotifications()` when session is established (non-null)
  - [x] 3.2 Ensure registration runs once per app launch (use `useRef` guard or `useEffect` dependency array)
  - [x] 3.3 Handle silent failure — catch errors, log to Sentry, do not block app
- [x] Task 4: Add notification preferences UI in settings (AC: #4)
  - [x] 4.1 Add "Notifications" `SectionLabel` between "Compte" and "Donnees" sections in `settings.tsx`
  - [x] 4.2 Add `SettingsCard` with two `Switch` toggle rows: "Streak Reminders", "Vocabulary Review Reminders"
  - [x] 4.3 Wire `Switch` `onValueChange` to `updatePreference()` from hook
  - [x] 4.4 Show success/error toasts on preference update
  - [x] 4.5 Add "Enable Notifications" row when `permissionStatus === 'denied'` — opens `Linking.openSettings()`
  - [x] 4.6 Add accessibility labels: `accessibilityRole="switch"`, `accessibilityLabel`, `accessibilityState={{ checked }}`
- [x] Task 5: Quality gates (AC: #Z)
  - [x] 5.1 Run `npm run type-check && npm run lint && npm run format:check`
  - [x] 5.2 Verify all colors use `Colors.*` tokens, all text uses `Typography.*` presets
  - [x] 5.3 Verify all catch blocks use `captureError()`

## Dev Notes

### Expo Notifications API — Key Functions

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Check current permission status
const { status } = await Notifications.getPermissionsAsync();

// Request permission (shows OS dialog on first call)
const { status: newStatus } = await Notifications.requestPermissionsAsync();

// Get Expo push token (requires physical device or EAS build)
const tokenData = await Notifications.getExpoPushTokenAsync({
  projectId: 'ce8862a4-5a0a-4276-8cb6-24faeaee424a', // from app.json extra.eas.projectId
});
const pushToken = tokenData.data; // "ExponentPushToken[xxx]"

// Listen for notification taps
const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
  const screen = response.notification.request.content.data?.screen;
  // Navigate based on screen value
});

// Clean up listener
subscription.remove();
```

**Important:** `getExpoPushTokenAsync()` will throw on Expo Go and simulators without push capability. Wrap in try/catch and fail silently. Use `Device.isDevice` to check if running on a physical device before requesting token.

### Android-Specific: Notification Channel

Android requires a notification channel. Set it up before requesting the token:

```typescript
if (Platform.OS === 'android') {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1E3A5F',
  });
}
```

### Edge Function Call Pattern

Use `supabase.functions.invoke()` — the same pattern used throughout the app for Edge Function calls:

```typescript
import { supabase } from '@/src/lib/supabase';

// Register device token
const { data, error } = await supabase.functions.invoke('notification-register', {
  body: { action: 'register', token: pushToken, platform: Platform.OS, deviceName: Device.deviceName },
});

// Update preferences
const { data, error } = await supabase.functions.invoke('notification-register', {
  body: { action: 'preferences', streakAlerts: true, srsReminders: false },
});

// Get preferences
const { data, error } = await supabase.functions.invoke('notification-register', {
  body: { action: 'get-preferences' },
});
```

The Edge Function expects a valid JWT in the Authorization header — `supabase.functions.invoke()` automatically includes this from the authenticated session.

### Settings Screen Pattern — DO NOT Deviate

The settings screen (`app/(tabs)/profile/settings.tsx`) uses these helper components (defined in-file):
- `SectionLabel({ children })` — section header text
- `SettingsCard({ children })` — white card wrapper
- `CardLabel({ children })` — label text inside card
- `RowDivider` — horizontal divider between rows

Follow the exact same pattern for the notification section. The section order is:
1. Apprentissage (learning)
2. Compte (account)
3. **Notifications** ← NEW (insert here)
4. Donnees (data)
5. A propos (about)

### Switch Component Styling

React Native's built-in `Switch` component — do NOT create a custom toggle:

```tsx
import { Switch } from 'react-native';

<Switch
  value={preferences.streakAlerts}
  onValueChange={(value) => updatePreference('streakAlerts', value)}
  trackColor={{ false: Colors.gray300, true: Colors.primary }}
  thumbColor={Colors.white}
  accessibilityRole="switch"
  accessibilityLabel="Streak reminders"
  accessibilityState={{ checked: preferences.streakAlerts }}
/>
```

### Auto-Registration Pattern in _layout.tsx

The root layout (`app/_layout.tsx`) already has auth state management via `useAuth()`. Add notification registration alongside the existing session logic:

```typescript
const { session } = useAuth();
const { registerForPushNotifications } = useNotifications();
const hasRegistered = useRef(false);

useEffect(() => {
  if (session && !hasRegistered.current) {
    hasRegistered.current = true;
    registerForPushNotifications().catch((err) => {
      captureError(err, 'notification-registration');
    });
  }
}, [session]);
```

**Critical:** Use `useRef` to prevent re-registration on every render. Registration should fire once per app launch when the session is established.

### Deep Link Navigation

The app uses `expo-router` with typed routes. Deep link targets:
- `data.screen === 'home'` → `router.replace('/(tabs)/home')`
- `data.screen === 'vocabulary'` → `router.replace('/(tabs)/practice/vocabulary')`

Set up the listener in the hook (not in `_layout.tsx`) to keep notification logic centralized. Clean up on unmount.

### What Story 8-1 Already Provides (DO NOT Recreate)

| Asset | Location | What It Does |
|-------|----------|-------------|
| `device_tokens` table | `supabase/migrations/20260401000000_device_tokens.sql` | Token storage with RLS, indexes, cascade delete |
| `profiles.streak_alerts` | Same migration | Boolean preference, default true |
| `profiles.srs_reminders` | Same migration | Boolean preference, default true |
| `notification-register` Edge Function | `supabase/functions/notification-register/index.ts` | Token CRUD + preference management |
| Expo token format validation | In Edge Function | `/^ExponentPushToken\[.+\]$/` regex |

### What Story 8-2 Already Provides (DO NOT Recreate)

| Asset | Location | What It Does |
|-------|----------|-------------|
| `send-notifications` Edge Function | `supabase/functions/send-notifications/index.ts` | Server-side notification delivery |
| Invalid token cleanup | In Edge Function | Deletes `DeviceNotRegistered` tokens |
| pg_cron scheduling | `supabase/migrations/20260402000000_notification_cron.sql` | Hourly notification check |

### EAS Project ID

Already configured: `ce8862a4-5a0a-4276-8cb6-24faeaee424a` in `app.json` → `extra.eas.projectId`. Use this in `getExpoPushTokenAsync({ projectId })`.

### Existing Utilities — DO NOT Recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `captureError()` | `@/src/lib/sentry` | Error logging in catch blocks |
| `useToast()` | `@/src/hooks/use-toast` | Success/error toast messages |
| `requireNetwork()` | `@/src/lib/network` | Network check before API calls (optional here — Edge Function calls fail gracefully) |
| `Colors`, `Typography` | `@/src/lib/design` | All styling tokens |
| `supabase` | `@/src/lib/supabase` | Authenticated Supabase client |

### Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/use-notifications.ts` | Push token registration, preferences, deep linking |

### Files to Modify

| File | Change |
|------|--------|
| `app.json` | Add `expo-notifications` to plugins |
| `app/(tabs)/profile/settings.tsx` | Add Notifications section with Switch toggles |
| `app/_layout.tsx` | Add auto-registration on session establishment |
| `package.json` | `expo-notifications` + `expo-device` added by `npx expo install` |

### What This Story Does NOT Include

- NO server-side notification sending logic — already done in story 8-2
- NO `send-notifications` Edge Function changes — already done
- NO database migrations — `device_tokens` table and preference columns already exist from story 8-1
- NO pg_cron configuration — already done in story 8-2
- NO changes to `notification-register` Edge Function — already complete from story 8-1

### Project Structure Notes

- Hook: `src/hooks/use-notifications.ts` — alongside existing hooks (`use-auth.ts`, `use-exercise.ts`, etc.)
- Settings UI changes: inline in `settings.tsx` — no new screen or component file needed
- Layout changes: inline in `_layout.tsx` — add registration effect alongside existing auth logic
- No new Supabase Edge Functions or migrations in this story

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.3]
- [Source: _bmad-output/planning-artifacts/prd.md — FR60 (notification preferences)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Notification Engine, lines 260-269]
- [Source: _bmad-output/implementation-artifacts/8-1-device-token-registration-edge-function.md — Edge Function contracts, EAS projectId]
- [Source: _bmad-output/implementation-artifacts/8-2-streak-srs-notification-delivery.md — Deep link data payloads, notification message templates]
- [Source: app/(tabs)/profile/settings.tsx — Settings screen helper component pattern]
- [Source: app/_layout.tsx — Auth session management and effect patterns]
- [Source: app.json — Current plugins configuration, EAS projectId]
- [Source: src/hooks/use-auth.ts — Auth state change patterns]
- [Source: src/lib/design.ts — Colors.primary, Colors.gray300, Colors.white tokens]
- [Source: src/hooks/use-toast.ts — Toast notification pattern]
- [Source: Expo Notifications docs — getExpoPushTokenAsync, permissions, notification channels]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Installed `expo-notifications` and `expo-device` via `npx expo install`
- Added `expo-notifications` plugin to `app.json` with primary brand color
- Created `src/hooks/use-notifications.ts` — full push notification lifecycle hook:
  - Permission checking + requesting via `expo-notifications`
  - Expo push token retrieval (physical device guard via `expo-device`)
  - Token registration via `notification-register` Edge Function
  - Preference loading from Edge Function on mount
  - Optimistic preference updates with rollback on failure
  - Android notification channel setup
  - Deep link handling via `addNotificationResponseReceivedListener` (home + vocabulary routes)
- Wired auto-registration in `app/_layout.tsx` with `useRef` guard (once per app launch, silent failure)
- Added Notifications section in settings between Compte and Données:
  - Two `Switch` toggles: Streak Reminders, Vocabulary Review Reminders
  - Success/error toasts on preference changes
  - "Enable Notifications" row when permission denied → opens device settings
  - Full accessibility: `accessibilityRole="switch"`, `accessibilityLabel`, `accessibilityState`
- All quality gates pass: `type-check`, `lint`, `format:check`
- All colors use `Colors.*` design tokens, all catch blocks use `captureError()`

### Change Log

- 2026-04-01: Story 8-3 implementation complete — notification preferences UI and client integration

### File List

**New:**
- `src/hooks/use-notifications.ts`

**Modified:**
- `app.json` — added `expo-notifications` plugin
- `app/_layout.tsx` — added auto-registration on auth with useRef guard
- `app/(tabs)/profile/settings.tsx` — added Notifications section with Switch toggles
- `package.json` — `expo-notifications` + `expo-device` dependencies
- `package-lock.json` — updated lockfile
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status updated
