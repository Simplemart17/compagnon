import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
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
      style={{
        fontSize: 11,
        fontWeight: "700",
        color: "#F5A623",
        letterSpacing: 1,
        textTransform: "uppercase",
        marginBottom: 8,
        marginTop: topMargin,
        paddingHorizontal: 4,
      }}
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
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        padding: 16,
        marginBottom,
        shadowColor: "#000",
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
      style={{
        fontSize: 13,
        fontWeight: "600",
        color: "#999",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 12,
      }}
    >
      {children}
    </Text>
  );
}

interface RowDividerProps {
  verticalSpacing?: number;
}

function RowDivider({ verticalSpacing = 14 }: RowDividerProps) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: "#F0F0E8",
        marginVertical: verticalSpacing,
      }}
    />
  );
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

  async function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "This will permanently delete ALL your data including vocabulary, conversations, exercises, and progress. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Everything",
          style: "destructive",
          onPress: async () => {
            if (!session?.user?.id) return;
            setDeletingAccount(true);

            try {
              const userId = session.user.id;
              // Delete user data from all tables (RLS ensures user can only delete their own)
              await Promise.all([
                supabase.from("companion_memory").delete().eq("user_id", userId),
                supabase.from("error_patterns").delete().eq("user_id", userId),
                supabase.from("daily_activity").delete().eq("user_id", userId),
                supabase.from("mock_tests").delete().eq("user_id", userId),
                supabase.from("vocabulary").delete().eq("user_id", userId),
                supabase.from("exercises").delete().eq("user_id", userId),
                supabase.from("skill_progress").delete().eq("user_id", userId),
                supabase
                  .from("conversation_messages")
                  .delete()
                  .in(
                    "conversation_id",
                    (
                      await supabase.from("conversations").select("id").eq("user_id", userId)
                    ).data?.map((c) => c.id) ?? []
                  ),
                supabase.from("conversations").delete().eq("user_id", userId),
              ]);

              // Delete profile last
              await supabase.from("profiles").delete().eq("id", userId);

              // Sign out
              await signOut();
            } catch (err) {
              captureError(err, "account-deletion");
              Alert.alert("Error", "Failed to delete account. Please contact support.");
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
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
      <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
        {/* ----------------------------------------------------------------
            Custom header
        ---------------------------------------------------------------- */}
        <View
          style={{
            backgroundColor: "#FFFFFF",
            borderBottomWidth: 1,
            borderBottomColor: "#F0F0E8",
            paddingTop: insets.top + 16,
            paddingBottom: 16,
            paddingHorizontal: 24,
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ flexDirection: "row", alignItems: "center" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#1E3A5F" }}>
              {"\u2190"} Param{"\u00E8"}tres
            </Text>
          </TouchableOpacity>
        </View>

        {/* ----------------------------------------------------------------
            Scrollable content
        ---------------------------------------------------------------- */}
        <ScrollView
          style={{ flex: 1 }}
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CEFR_ORDER.map((level) => {
                const selected = currentLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    onPress={() => handleUpdateLevel(level)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 12,
                      backgroundColor: selected ? "#1E3A5F" : "#F5F5F0",
                      borderWidth: 1,
                      borderColor: selected ? "#F5A623" : "#E0E0CE",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: selected ? "#FFFFFF" : "#1E3A5F",
                      }}
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CEFR_ORDER.map((level) => {
                const selected = targetLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    onPress={() => handleUpdateTarget(level)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 12,
                      backgroundColor: selected ? "#1E3A5F" : "#F5F5F0",
                      borderWidth: 1,
                      borderColor: selected ? "#F5A623" : "#E0E0CE",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: selected ? "#FFFFFF" : "#1E3A5F",
                      }}
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {DAILY_GOAL_OPTIONS.map((minutes) => {
                const selected = dailyGoal === minutes;
                return (
                  <TouchableOpacity
                    key={minutes}
                    onPress={() => handleUpdateDailyGoal(minutes)}
                    style={{
                      paddingHorizontal: 18,
                      paddingVertical: 8,
                      borderRadius: 12,
                      backgroundColor: selected ? "#F5A623" : "#F5F5F0",
                      borderWidth: 1,
                      borderColor: selected ? "#F5A623" : "#E0E0CE",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: selected ? "#FFFFFF" : "#1E3A5F",
                      }}
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
                  style={{
                    fontSize: 16,
                    color: "#333",
                    backgroundColor: "#F5F5F0",
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: Platform.OS === "ios" ? 12 : 10,
                    borderWidth: 1,
                    borderColor: "#E0E0CE",
                  }}
                  value={nameValue}
                  onChangeText={setNameValue}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                  maxLength={50}
                  placeholder="Votre prénom"
                  placeholderTextColor="#999"
                />
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <TouchableOpacity
                    onPress={handleSaveName}
                    style={{
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: "#F5A623",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 14 }}>
                      Enregistrer
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelNameEdit}
                    style={{
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: "#F0F0E8",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#666", fontWeight: "600", fontSize: 14 }}>Annuler</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 16, color: "#333" }}>
                  {profile?.full_name ?? "Non défini"}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setNameValue(profile?.full_name ?? "");
                    setEditingName(true);
                  }}
                >
                  <Text style={{ fontSize: 14, color: "#F5A623", fontWeight: "600" }}>
                    Modifier
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </SettingsCard>

          {/* Email */}
          <SettingsCard>
            <CardLabel>Adresse e-mail</CardLabel>
            <Text style={{ fontSize: 16, color: "#666" }}>{email}</Text>
          </SettingsCard>

          {/* Sign out */}
          <TouchableOpacity
            onPress={handleSignOut}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 14,
              padding: 16,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#FF3B30",
              marginTop: 4,
              marginBottom: 24,
            }}
          >
            <Text style={{ color: "#FF3B30", fontWeight: "600", fontSize: 16 }}>
              Se d{"\u00E9"}connecter
            </Text>
          </TouchableOpacity>

          {/* ---- Section: Données ---- */}
          <SectionLabel topMargin={0}>Donn{"\u00E9"}es</SectionLabel>

          <SettingsCard>
            <TouchableOpacity
              onPress={handleExportData}
              disabled={exportingData}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                opacity: exportingData ? 0.5 : 1,
              }}
            >
              <View>
                <Text style={{ fontSize: 15, color: "#333" }}>Exporter mes donn{"\u00E9"}es</Text>
                <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                  Download all your data as JSON
                </Text>
              </View>
              {exportingData ? (
                <ActivityIndicator size="small" color="#1E3A5F" />
              ) : (
                <Text style={{ fontSize: 14, color: "#1E3A5F", fontWeight: "600" }}>
                  Export {"\u2192"}
                </Text>
              )}
            </TouchableOpacity>

            <RowDivider />

            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                opacity: deletingAccount ? 0.5 : 1,
              }}
            >
              <View>
                <Text style={{ fontSize: 15, color: "#FF3B30" }}>Supprimer mon compte</Text>
                <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                  Permanently delete all your data
                </Text>
              </View>
              {deletingAccount ? (
                <ActivityIndicator size="small" color="#FF3B30" />
              ) : (
                <Text style={{ fontSize: 14, color: "#FF3B30", fontWeight: "600" }}>Delete</Text>
              )}
            </TouchableOpacity>
          </SettingsCard>

          {/* ---- Section: À propos ---- */}
          <SectionLabel topMargin={0}>{"\u00C0"} propos</SectionLabel>

          <SettingsCard marginBottom={0}>
            {/* App version */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 15, color: "#333" }}>Version de l&apos;app</Text>
              <Text style={{ fontSize: 15, color: "#999" }}>
                {Constants.expoConfig?.version ?? "1.0.0"}
              </Text>
            </View>

            <RowDivider />

            {/* Privacy Policy */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/privacy-policy")}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 15, color: "#333" }}>
                Politique de confidentialit{"\u00E9"}
              </Text>
              <Text style={{ fontSize: 14, color: "#F5A623", fontWeight: "600" }}>
                Voir {"\u2192"}
              </Text>
            </TouchableOpacity>

            <RowDivider />

            {/* Terms of Service */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile/terms")}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 15, color: "#333" }}>Conditions d&apos;utilisation</Text>
              <Text style={{ fontSize: 14, color: "#F5A623", fontWeight: "600" }}>
                Voir {"\u2192"}
              </Text>
            </TouchableOpacity>
          </SettingsCard>
        </ScrollView>
      </View>
    </>
  );
}
