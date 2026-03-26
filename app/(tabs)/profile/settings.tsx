import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  Share,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";

import { useAuth } from "@/src/hooks/use-auth";
import { useAuthStore } from "@/src/store/auth-store";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";
import { Colors } from "@/src/lib/design";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAILY_GOAL_OPTIONS = [5, 10, 15, 30] as const;

// ---------------------------------------------------------------------------
// Helper sub-components
// ---------------------------------------------------------------------------

interface SectionLabelProps {
  children: React.ReactNode;
  topMargin?: number;
}

function SectionLabel({ children, topMargin = 0 }: SectionLabelProps) {
  return (
    <Text
      className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest"
      style={{ marginTop: topMargin, color: Colors.accentText }}
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

interface SettingsCardProps {
  children: React.ReactNode;
  marginBottom?: number;
}

function SettingsCard({ children, marginBottom = 12 }: SettingsCardProps) {
  return (
    <View
      className="rounded-2xl bg-white p-4"
      style={{
        marginBottom,
        shadowColor: Colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      {children}
    </View>
  );
}

interface CardLabelProps {
  children: string;
}

function CardLabel({ children }: CardLabelProps) {
  return (
    <Text
      className="mb-3 text-[13px] font-semibold uppercase tracking-wide"
      style={{ color: Colors.textTertiary }}
    >
      {children}
    </Text>
  );
}

interface RowDividerProps {
  verticalSpacing?: number;
}

function RowDivider({ verticalSpacing = 14 }: RowDividerProps) {
  return <View className="h-px bg-surface-200" style={{ marginVertical: verticalSpacing }} />;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const { profile, updateProfile, signOut } = useAuth();
  const session = useAuthStore((s) => s.session);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(profile?.full_name ?? "");

  const currentLevel = profile?.current_cefr_level ?? "A1";
  const targetLevel = profile?.target_cefr_level ?? "C1";
  const dailyGoal = profile?.daily_goal_minutes ?? 15;
  const email = session?.user?.email ?? "";

  function handleUpdateLevel(level: CEFRLevel) {
    if (level === currentLevel) return;
    Alert.alert(
      "Change Level",
      `Set your current level to ${level}? This may affect exercise difficulty.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            const { error } = await updateProfile({ current_cefr_level: level });
            if (error) Alert.alert("Error", "Failed to update level. Please try again.");
          },
        },
      ]
    );
  }

  function handleUpdateTarget(level: CEFRLevel) {
    if (level === targetLevel) return;
    Alert.alert("Change Target", `Set your target level to ${level}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          void updateProfile({ target_cefr_level: level }).then(({ error }) => {
            if (error) Alert.alert("Error", "Failed to update target. Please try again.");
          });
        },
      },
    ]);
  }

  function handleUpdateDailyGoal(minutes: number) {
    if (minutes === dailyGoal) return;
    Alert.alert("Change Daily Goal", `Set your daily goal to ${minutes} minutes?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          void updateProfile({ daily_goal_minutes: minutes }).then(({ error }) => {
            if (error) Alert.alert("Error", "Failed to update daily goal. Please try again.");
          });
        },
      },
    ]);
  }

  async function handleSaveName() {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      Alert.alert("Error", "Display name cannot be empty.");
      return;
    }
    const { error } = await updateProfile({ full_name: trimmed });
    if (error) {
      Alert.alert("Error", "Failed to update name. Please try again.");
    }
    setEditingName(false);
  }

  function handleCancelNameEdit() {
    setNameValue(profile?.full_name ?? "");
    setEditingName(false);
  }

  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  async function handleExportData() {
    if (!session?.user?.id) return;
    setExportingData(true);

    try {
      const userId = session.user.id;
      const [profileRes, vocabRes, convRes, exerciseRes, progressRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("vocabulary").select("*").eq("user_id", userId),
        supabase.from("conversations").select("*").eq("user_id", userId),
        supabase.from("exercises").select("*").eq("user_id", userId),
        supabase.from("skill_progress").select("*").eq("user_id", userId),
      ]);

      const exportData = {
        exportDate: new Date().toISOString(),
        profile: profileRes.data,
        vocabulary: vocabRes.data ?? [],
        conversations: convRes.data ?? [],
        exercises: exerciseRes.data ?? [],
        skillProgress: progressRes.data ?? [],
      };

      await Share.share({
        message: JSON.stringify(exportData, null, 2),
        title: "Companion App Data Export",
      });
    } catch (err) {
      captureError(err, "data-export");
      Alert.alert("Export Failed", "Could not export your data. Please try again.");
    } finally {
      setExportingData(false);
    }
  }

  function handleDeleteAccount() {
    // Step 1: Initial warning dialog
    Alert.alert(
      "Delete Account",
      "This will permanently delete ALL your data including vocabulary, conversations, exercises, and progress. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: () => {
            // Step 2: Show inline confirmation where user types "DELETE"
            setDeleteConfirmText("");
            setShowDeleteConfirm(true);
          },
        },
      ]
    );
  }

  async function confirmDeleteAccount() {
    if (deleteConfirmText.toUpperCase() !== "DELETE") {
      Alert.alert("Error", 'Please type "DELETE" (all caps) to confirm account deletion.');
      return;
    }
    if (!session?.user?.id) {
      Alert.alert("Error", "Session expired. Please sign in again.");
      setShowDeleteConfirm(false);
      return;
    }
    setDeletingAccount(true);

    try {
      const { error } = await supabase.functions.invoke("account-delete");
      if (error) throw error;
    } catch (err) {
      captureError(err, "account-deletion");
      Alert.alert("Error", "Failed to delete account. Please contact support.");
      setDeletingAccount(false);
      setShowDeleteConfirm(false);
      return;
    }

    try {
      await signOut();
    } catch {
      // Account is already deleted server-side; sign-out failure is non-critical.
      // Auth listener will clean up the session on next startup.
    } finally {
      setDeletingAccount(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface">
        {/* ----------------------------------------------------------------
            Custom header
        ---------------------------------------------------------------- */}
        <View
          className="border-b border-surface-200 bg-white px-6 pb-4"
          style={{ paddingTop: insets.top + 16 }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            className="flex-row items-center"
            style={{ minHeight: 44, justifyContent: "center" }}
            accessibilityRole="button"
            accessibilityLabel="Go back to profile"
          >
            <Text className="text-base font-bold text-primary">← Paramètres</Text>
          </TouchableOpacity>
        </View>

        {/* ----------------------------------------------------------------
            Scrollable content
        ---------------------------------------------------------------- */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 24,
            paddingBottom: 48,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Section: Apprentissage ---- */}
          <SectionLabel topMargin={0}>Apprentissage</SectionLabel>

          {/* Current CEFR level */}
          <SettingsCard>
            <CardLabel>Niveau actuel</CardLabel>
            <View className="flex-row flex-wrap gap-2">
              {CEFR_ORDER.map((level) => {
                const selected = currentLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    onPress={() => handleUpdateLevel(level)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Level ${level}`}
                    accessibilityState={{ selected }}
                    accessibilityHint={selected ? undefined : "Double tap to set as current level"}
                    className="rounded-xl border px-3.5 py-2"
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      backgroundColor: selected ? Colors.primary : Colors.surface,
                      borderColor: selected ? Colors.accent : Colors.border,
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: selected ? Colors.surfaceWhite : Colors.primary }}
                    >
                      {level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SettingsCard>

          {/* Target CEFR level */}
          <SettingsCard>
            <CardLabel>Niveau cible</CardLabel>
            <View className="flex-row flex-wrap gap-2">
              {CEFR_ORDER.map((level) => {
                const selected = targetLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    onPress={() => handleUpdateTarget(level)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Target level ${level}`}
                    accessibilityState={{ selected }}
                    accessibilityHint={selected ? undefined : "Double tap to set as target level"}
                    className="rounded-xl border px-3.5 py-2"
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      backgroundColor: selected ? Colors.primary : Colors.surface,
                      borderColor: selected ? Colors.accent : Colors.border,
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: selected ? Colors.surfaceWhite : Colors.primary }}
                    >
                      {level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SettingsCard>

          {/* Daily goal */}
          <SettingsCard>
            <CardLabel>Objectif quotidien</CardLabel>
            <View className="flex-row flex-wrap gap-2">
              {DAILY_GOAL_OPTIONS.map((minutes) => {
                const selected = dailyGoal === minutes;
                return (
                  <TouchableOpacity
                    key={minutes}
                    onPress={() => handleUpdateDailyGoal(minutes)}
                    accessibilityRole="radio"
                    accessibilityLabel={`${minutes} minutes per day`}
                    accessibilityState={{ selected }}
                    accessibilityHint={selected ? undefined : "Double tap to set as daily goal"}
                    className="rounded-xl border px-[18px] py-2"
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      backgroundColor: selected ? Colors.accent : Colors.surface,
                      borderColor: selected ? Colors.accent : Colors.border,
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: selected ? Colors.surfaceWhite : Colors.primary }}
                    >
                      {minutes} min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SettingsCard>

          {/* ---- Section: Compte ---- */}
          <SectionLabel topMargin={20}>Compte</SectionLabel>

          {/* Display name */}
          <SettingsCard>
            <CardLabel>Nom d&apos;affichage</CardLabel>
            {editingName ? (
              <View>
                <TextInput
                  className="rounded-[10px] border border-surface-300 bg-surface px-3.5 text-base text-primary"
                  style={{
                    paddingVertical: Platform.OS === "ios" ? 12 : 10,
                  }}
                  value={nameValue}
                  onChangeText={setNameValue}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                  maxLength={50}
                  placeholder="Votre prénom"
                  placeholderTextColor={Colors.textTertiary}
                />
                <View className="mt-3 flex-row gap-2.5">
                  <TouchableOpacity
                    onPress={handleSaveName}
                    accessibilityRole="button"
                    accessibilityLabel="Save display name"
                    className="items-center rounded-[10px] bg-accent px-5 py-2.5"
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text className="text-sm font-semibold text-white">Enregistrer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelNameEdit}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing display name"
                    className="items-center rounded-[10px] bg-surface-200 px-5 py-2.5"
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: Colors.gray700 }}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-primary">
                  {profile?.full_name ?? "Non d\u00E9fini"}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setNameValue(profile?.full_name ?? "");
                    setEditingName(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Edit display name"
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ color: Colors.accentText }} className="text-sm font-semibold">
                    Modifier
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </SettingsCard>

          {/* Email */}
          <SettingsCard>
            <CardLabel>Adresse e-mail</CardLabel>
            <Text className="text-base" style={{ color: Colors.gray700 }}>
              {email}
            </Text>
          </SettingsCard>

          {/* Sign out */}
          <TouchableOpacity
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="mb-6 mt-1 items-center rounded-2xl border border-error bg-white p-4"
          >
            <Text className="text-base font-semibold text-error">Se déconnecter</Text>
          </TouchableOpacity>

          {/* ---- Section: Donnees ---- */}
          <SectionLabel topMargin={0}>Données</SectionLabel>

          <SettingsCard>
            <TouchableOpacity
              onPress={handleExportData}
              disabled={exportingData}
              accessibilityRole="button"
              accessibilityLabel="Export my data"
              accessibilityState={{ disabled: exportingData, busy: exportingData }}
              className="flex-row items-center justify-between"
              style={{ minHeight: 44, opacity: exportingData ? 0.5 : 1 }}
            >
              <View>
                <Text className="text-[15px] text-primary">Exporter mes données</Text>
                <Text className="mt-0.5 text-xs" style={{ color: Colors.textTertiary }}>
                  Download all your data as JSON
                </Text>
              </View>
              <Text className="text-sm font-semibold text-primary">
                {exportingData ? "Exporting..." : "Export \u2192"}
              </Text>
            </TouchableOpacity>

            <RowDivider />

            {showDeleteConfirm ? (
              <View>
                <Text className="mb-2 text-sm font-semibold text-error">
                  Type &quot;DELETE&quot; to confirm account deletion
                </Text>
                <TextInput
                  className="rounded-[10px] border border-error bg-surface px-3.5 text-base text-primary"
                  style={{
                    paddingVertical: Platform.OS === "ios" ? 12 : 10,
                  }}
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  autoFocus
                  autoCapitalize="characters"
                  placeholder='Type "DELETE"'
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel="Type DELETE to confirm"
                  accessibilityHint="Type the word DELETE in capitals to confirm account deletion"
                />
                <View className="mt-3 flex-row gap-2.5">
                  <TouchableOpacity
                    onPress={confirmDeleteAccount}
                    disabled={deletingAccount}
                    accessibilityRole="button"
                    accessibilityLabel="Permanently delete account"
                    accessibilityState={{ disabled: deletingAccount, busy: deletingAccount }}
                    className="items-center rounded-[10px] bg-error px-5 py-2.5"
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      opacity: deletingAccount ? 0.5 : 1,
                    }}
                  >
                    <Text className="text-sm font-semibold text-white">
                      {deletingAccount ? "Deleting..." : "Supprimer d\u00E9finitivement"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowDeleteConfirm(false)}
                    disabled={deletingAccount}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel account deletion"
                    className="items-center rounded-[10px] bg-surface-200 px-5 py-2.5"
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      opacity: deletingAccount ? 0.5 : 1,
                    }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: Colors.gray700 }}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handleDeleteAccount}
                disabled={deletingAccount}
                accessibilityRole="button"
                accessibilityLabel="Delete my account"
                accessibilityHint="This will permanently delete all your data"
                accessibilityState={{ disabled: deletingAccount }}
                className="flex-row items-center justify-between"
                style={{ minHeight: 44, opacity: deletingAccount ? 0.5 : 1 }}
              >
                <View>
                  <Text className="text-[15px] text-error">Supprimer mon compte</Text>
                  <Text className="mt-0.5 text-xs" style={{ color: Colors.textTertiary }}>
                    Permanently delete all your data
                  </Text>
                </View>
                <Text className="text-sm font-semibold text-error">
                  {deletingAccount ? "Deleting..." : "Delete"}
                </Text>
              </TouchableOpacity>
            )}
          </SettingsCard>

          {/* ---- Section: A propos ---- */}
          <SectionLabel topMargin={0}>À propos</SectionLabel>

          <SettingsCard marginBottom={0}>
            {/* App version */}
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] text-primary">Version de l&apos;app</Text>
              <Text className="text-[15px]" style={{ color: Colors.textTertiary }}>
                {Constants.expoConfig?.version ?? "1.0.0"}
              </Text>
            </View>

            <RowDivider />

            {/* Privacy Policy */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/privacy-policy")}
              accessibilityRole="button"
              accessibilityLabel="View privacy policy"
              className="flex-row items-center justify-between"
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-[15px] text-primary">Politique de confidentialité</Text>
              <Text style={{ color: Colors.accentText }} className="text-sm font-semibold">
                Voir {"\u2192"}
              </Text>
            </TouchableOpacity>

            <RowDivider />

            {/* Terms of Service */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/terms")}
              accessibilityRole="button"
              accessibilityLabel="View terms of service"
              className="flex-row items-center justify-between"
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-[15px] text-primary">Conditions d&apos;utilisation</Text>
              <Text style={{ color: Colors.accentText }} className="text-sm font-semibold">
                Voir {"\u2192"}
              </Text>
            </TouchableOpacity>
          </SettingsCard>
        </ScrollView>
      </View>
    </>
  );
}
