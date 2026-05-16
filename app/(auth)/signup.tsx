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
  ScrollView,
} from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { PasswordStrengthIndicator } from "@/src/components/auth/PasswordStrengthIndicator";
import { Icon } from "@/src/components/common/Icon";
import { useAuth } from "@/src/hooks/use-auth";
import { Colors } from "@/src/lib/design";
import {
  MIN_PASSWORD_LENGTH,
  getGenericWeakPasswordMessage,
  getPwnedMessage,
  isPwnedRejection,
  mapSupabaseWeakPasswordError,
  passwordPolicyReasonToMessage,
  validatePasswordStrength,
} from "@/src/lib/password-policy";
import { captureError } from "@/src/lib/sentry";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.32;

export default function SignUpScreen() {
  const { signUpWithEmail } = useAuth();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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

  async function handleSignUp() {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert("Error", "Please enter a valid email address.");
      return;
    }

    const policyResult = validatePasswordStrength(password);
    if (!policyResult.valid) {
      const itemized = policyResult.reasons.map(passwordPolicyReasonToMessage).join("\n");
      Alert.alert("Password invalid", itemized);
      return;
    }

    setLoading(true);
    try {
      // R2-P1: trim the password before passing to signUpWithEmail so the
      // bytes Supabase stores (bcrypt hashes the raw input — no
      // server-side trim) match the bytes the client validated. Without
      // this, a user typing `"Abcdefghi1 "` (10 content chars + trailing
      // space) would sign up successfully but fail every subsequent
      // sign-in because iOS/Android keyboards auto-strip trailing
      // whitespace at sign-in time. validatePasswordStrength's internal
      // trim already enforced the rule on the client; this trim closes
      // the round-trip hazard at the storage layer.
      const trimmedPassword = password.trim();
      const { error } = await signUpWithEmail(email.trim(), trimmedPassword, fullName.trim());
      if (error) {
        if (isPwnedRejection(error)) {
          Alert.alert("Password invalid", getPwnedMessage());
        } else {
          // R2-P1: pass `trimmedPassword` (the bytes the server actually
          // saw) to the mapper so the always-merge re-validates against
          // the same bytes that triggered the rejection.
          const mapped = mapSupabaseWeakPasswordError(error, trimmedPassword);
          if (mapped !== null) {
            // Story 12-8 review-round-1 P7 (Story 14-1 EN conversion):
            // ALWAYS surface a localized message for weak_password
            // rejections, never the raw Supabase engineering text. Empty
            // mapped result happens when server-reported reasons are
            // unparseable; show the generic fallback in that case.
            const message =
              mapped.length > 0
                ? mapped.map(passwordPolicyReasonToMessage).join("\n")
                : getGenericWeakPasswordMessage();
            Alert.alert("Password invalid", message);
          } else {
            Alert.alert("Sign Up Failed", error.message);
          }
        }
      } else {
        Alert.alert(
          "Check Your Email",
          "We sent you a confirmation link. Please verify your email to continue."
        );
      }
    } catch (err) {
      captureError(err, "signup");
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      Alert.alert("Sign Up Failed", message);
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
          {/* Decorative top dots */}
          <View className="flex-row gap-[6px] mb-5 opacity-30">
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} className="w-1 h-1 rounded-full bg-accent" />
            ))}
          </View>

          <Text className="text-[42px] font-extrabold text-white tracking-tight mb-[10px]">
            Companion
          </Text>

          {/* Amber accent line */}
          <View className="w-12 h-1 bg-accent rounded-full mb-[14px]" />

          <Text className="text-sm text-white/60 italic tracking-wide">Start your journey</Text>
        </View>

        {/* White Card */}
        <Reanimated.View
          style={[
            {
              flex: 1,
              backgroundColor: Colors.surfaceWhite,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              shadowColor: Colors.shadow,
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 8,
            },
            cardAnimatedStyle,
          ]}
        >
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingTop: 32,
              paddingBottom: insets.bottom + 24,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Card Title */}
            <Text className="text-[26px] font-extrabold text-primary mb-6">Create account</Text>

            {/* Full Name Input */}
            <View className="mb-[14px]">
              <View
                className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
                style={{
                  borderWidth: 1.5,
                  borderColor: nameFocused ? Colors.accent : Colors.gray200,
                }}
              >
                <View style={{ marginRight: 10, opacity: nameFocused ? 1 : 0.4 }}>
                  <Icon name="user" size={18} color={Colors.textTertiary} />
                </View>
                <TextInput
                  placeholder="Full name"
                  placeholderTextColor={Colors.textTertiary}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  accessibilityLabel="Full name"
                  accessibilityHint="Enter your full name"
                  className="flex-1 text-[15px] text-primary p-0"
                />
              </View>
            </View>

            {/* Email Input */}
            <View className="mb-[14px]">
              <View
                className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
                style={{
                  borderWidth: 1.5,
                  borderColor: emailFocused ? Colors.accent : Colors.gray200,
                }}
              >
                <View style={{ marginRight: 10, opacity: emailFocused ? 1 : 0.4 }}>
                  <Icon name="mail" size={18} color={Colors.textTertiary} />
                </View>
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
                  accessibilityHint="Enter your email address to create an account"
                  className="flex-1 text-[15px] text-primary p-0"
                />
              </View>
            </View>

            {/* Password Input */}
            <View className="mb-[26px]">
              <View
                className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
                style={{
                  borderWidth: 1.5,
                  borderColor: passwordFocused ? Colors.accent : Colors.gray200,
                }}
              >
                <View style={{ marginRight: 10, opacity: passwordFocused ? 1 : 0.4 }}>
                  <Icon name="lock" size={18} color={Colors.textTertiary} />
                </View>
                <TextInput
                  placeholder={`Password (min. ${MIN_PASSWORD_LENGTH} characters)`}
                  placeholderTextColor={Colors.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  accessibilityLabel="Password"
                  accessibilityHint={`Enter a password with at least ${MIN_PASSWORD_LENGTH} characters and one uppercase, one lowercase, and one digit`}
                  className="flex-1 text-[15px] text-primary p-0"
                />
              </View>
              <PasswordStrengthIndicator password={password} />
            </View>

            {/* Primary Button */}
            <Reanimated.View style={buttonAnimatedStyle}>
              <Pressable
                onPress={handleSignUp}
                onPressIn={handleButtonPressIn}
                onPressOut={handleButtonPressOut}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Create account"
                accessibilityState={{ disabled: loading, busy: loading }}
                className="bg-primary rounded-xl py-[17px] items-center"
                style={{ opacity: loading ? 0.6 : 1 }}
              >
                <Text className="text-accent text-base font-bold tracking-wide">
                  Create my account
                </Text>
              </Pressable>
            </Reanimated.View>

            {/* Legal Notice */}
            <Text
              className="text-[11px] text-center mt-[18px] leading-[17px] px-2"
              style={{ color: Colors.textTertiary }}
            >
              By creating an account, you agree to our{" "}
              <Text
                className="text-primary font-semibold"
                onPress={() => router.push("/(auth)/terms")}
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                className="text-primary font-semibold"
                onPress={() => router.push("/(auth)/privacy-policy")}
              >
                Privacy Policy
              </Text>
              .
            </Text>

            {/* Sign In Row */}
            <View className="flex-row justify-center items-center mt-5 gap-1">
              <Text className="text-sm" style={{ color: Colors.textSecondary }}>
                Already have an account?{" "}
              </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel="Already have an account? Sign in"
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text className="text-accent text-sm font-bold">Sign in</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </ScrollView>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
