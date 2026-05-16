import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
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
import { Colors } from "@/src/lib/design";
import { captureError } from "@/src/lib/sentry";

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
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        Alert.alert("Error", error.message);
      } else {
        Alert.alert(
          "Check Your Email",
          "If an account exists with that email, we sent password reset instructions.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      }
    } catch (err) {
      captureError(err, "forgot-password");
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
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
    <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.bgDark }} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        {/* Hero Section */}
        <View
          className="items-center justify-center"
          style={{
            height: HERO_HEIGHT,
            paddingTop: insets.top > 0 ? 0 : 16,
            backgroundColor: Colors.bgDark,
          }}
        >
          {/* App name -- smaller at top */}
          <Text className="text-base font-semibold text-white/50 tracking-[2px] uppercase mb-5">
            Companion
          </Text>

          {/* Large key emoji as hero focal point */}
          <Text className="text-[52px] mb-4">🔑</Text>

          {/* Amber accent line */}
          <View className="w-12 h-1 bg-accent rounded-full mb-[14px]" />

          <Text className="text-sm text-white/50 tracking-wide italic">Recover your account</Text>
        </View>

        {/* White Card */}
        <Reanimated.View
          style={[
            {
              flex: 1,
              backgroundColor: Colors.surfaceWhite,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              paddingHorizontal: 24,
              paddingTop: 32,
              paddingBottom: insets.bottom + 16,
              shadowColor: Colors.shadow,
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 8,
            },
            cardAnimatedStyle,
          ]}
        >
          {/* Card Title */}
          <Text className="text-[26px] font-extrabold text-primary mb-[10px]">Forgot password</Text>

          {/* Description */}
          <Text className="text-sm leading-[21px] mb-7" style={{ color: Colors.textSecondary }}>
            Enter your email address and we&apos;ll send you a link to reset your password.
          </Text>

          {/* Email Input */}
          <View className="mb-6">
            <View
              className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
              style={{
                borderWidth: 1.5,
                borderColor: emailFocused ? Colors.accent : Colors.gray200,
              }}
            >
              <Text className="text-base mr-[10px]" style={{ opacity: emailFocused ? 1 : 0.4 }}>
                ✉️
              </Text>
              <TextInput
                placeholder="Email address"
                placeholderTextColor={Colors.textTertiary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                accessibilityLabel="Email address"
                accessibilityHint="Enter your email to receive a password reset link"
                className="flex-1 text-[15px] text-primary p-0"
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
              accessibilityRole="button"
              accessibilityLabel="Send reset link"
              accessibilityState={{ disabled: loading, busy: loading }}
              className="bg-primary rounded-xl py-[17px] items-center"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              <Text className="text-accent text-base font-bold tracking-wide">Send link</Text>
            </Pressable>
          </Reanimated.View>

          {/* Back Ghost Button */}
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back to login"
            className="items-center mt-5 py-3 min-h-[44px] rounded-xl"
            style={{
              borderWidth: 1.5,
              borderColor: Colors.gray200,
            }}
          >
            <Text className="text-sm font-medium" style={{ color: Colors.textSecondary }}>
              ← Back
            </Text>
          </TouchableOpacity>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
