import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { supabase } from "@/src/lib/supabase";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.38;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  // Card slide-up animation
  const cardTranslateY = useSharedValue(80);
  const cardOpacity = useSharedValue(0);

  // Button press scale animation
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    cardTranslateY.value = withSpring(0, {
      damping: 22,
      stiffness: 180,
      mass: 1,
    });
    cardOpacity.value = withTiming(1, { duration: 380 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardTranslateY.value }],
    opacity: cardOpacity.value,
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  async function handleReset() {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email address.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert("Error", "Please enter a valid email address.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert(
        "Check Your Email",
        "If an account exists with that email, we sent password reset instructions.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    }
  }

  const handleButtonPressIn = useCallback(() => {
    buttonScale.value = withTiming(0.97, { duration: 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleButtonPressOut = useCallback(() => {
    buttonScale.value = withTiming(1, { duration: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0D2240" }} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Hero Section */}
        <View
          style={{
            height: HERO_HEIGHT,
            backgroundColor: "#0D2240",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: insets.top > 0 ? 0 : 16,
          }}
        >
          {/* App name — smaller at top */}
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: "rgba(255,255,255,0.5)",
              letterSpacing: 2,
              textTransform: "uppercase",
              marginBottom: 20,
            }}
          >
            Compagnon
          </Text>

          {/* Large key emoji as hero focal point */}
          <Text style={{ fontSize: 52, marginBottom: 16 }}>🔑</Text>

          {/* Amber accent line */}
          <View
            style={{
              width: 48,
              height: 4,
              backgroundColor: "#F5A623",
              borderRadius: 2,
              marginBottom: 14,
            }}
          />

          <Text
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: 0.3,
              fontStyle: "italic",
            }}
          >
            Récupérez votre accès
          </Text>
        </View>

        {/* White Card */}
        <Reanimated.View
          style={[
            {
              flex: 1,
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              paddingHorizontal: 28,
              paddingTop: 32,
              paddingBottom: insets.bottom + 16,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 8,
            },
            cardAnimatedStyle,
          ]}
        >
          {/* Card Title */}
          <Text
            style={{
              fontSize: 26,
              fontWeight: "800",
              color: "#1E3A5F",
              marginBottom: 10,
            }}
          >
            Mot de passe oublié
          </Text>

          {/* Description */}
          <Text
            style={{
              fontSize: 14,
              color: "#888888",
              lineHeight: 21,
              marginBottom: 28,
            }}
          >
            Saisissez votre adresse e-mail et nous vous enverrons un lien pour réinitialiser votre
            mot de passe.
          </Text>

          {/* Email Input */}
          <View style={{ marginBottom: 24 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#FFFFFF",
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: emailFocused ? "#F5A623" : "#E8E8E0",
                paddingVertical: 16,
                paddingHorizontal: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  marginRight: 10,
                  opacity: emailFocused ? 1 : 0.4,
                }}
              >
                ✉️
              </Text>
              <TextInput
                placeholder="Adresse e-mail"
                placeholderTextColor="#AAAAAA"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: "#1E3A5F",
                  padding: 0,
                }}
              />
            </View>
          </View>

          {/* Primary Button */}
          <Reanimated.View style={buttonAnimatedStyle}>
            <Pressable
              onPress={handleReset}
              onPressIn={handleButtonPressIn}
              onPressOut={handleButtonPressOut}
              disabled={loading}
              style={{
                backgroundColor: "#1E3A5F",
                borderRadius: 16,
                paddingVertical: 17,
                alignItems: "center",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color="#F5A623" />
              ) : (
                <Text
                  style={{
                    color: "#F5A623",
                    fontSize: 16,
                    fontWeight: "700",
                    letterSpacing: 0.3,
                  }}
                >
                  Envoyer le lien
                </Text>
              )}
            </Pressable>
          </Reanimated.View>

          {/* Back Ghost Button */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              alignItems: "center",
              marginTop: 20,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: "#E8E8E0",
            }}
          >
            <Text
              style={{
                color: "#888888",
                fontSize: 14,
                fontWeight: "500",
              }}
            >
              ← Retour
            </Text>
          </TouchableOpacity>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
