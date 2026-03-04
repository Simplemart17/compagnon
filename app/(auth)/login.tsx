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
import { Link } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useAuth } from "@/src/hooks/use-auth";
import { Colors } from "@/src/lib/design";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.38;

export default function LoginScreen() {
  const { signInWithEmail } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
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

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert("Error", "Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await signInWithEmail(email.trim(), password);
      if (error) {
        Alert.alert("Login Failed", error.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      Alert.alert("Login Failed", message);
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
    <SafeAreaView className="flex-1 bg-[#0D2240]" edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        {/* Hero Section */}
        <View
          className="bg-[#0D2240] items-center justify-center"
          style={{
            height: HERO_HEIGHT,
            paddingTop: insets.top > 0 ? 0 : 16,
          }}
        >
          {/* Decorative top dots */}
          <View className="flex-row gap-[6px] mb-5 opacity-30">
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} className="w-1 h-1 rounded-full bg-accent" />
            ))}
          </View>

          <Text className="text-[42px] font-extrabold text-white tracking-tight mb-[10px]">
            Compagnon
          </Text>

          {/* Amber accent line */}
          <View className="w-12 h-1 bg-accent rounded-full mb-[14px]" />

          <Text className="text-sm text-white/60 italic tracking-wide">
            Parlez. Apprenez. Maîtrisez.
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
              paddingHorizontal: 24,
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
          <Text className="text-[26px] font-extrabold text-primary mb-6">Bon retour</Text>

          {/* Email Input */}
          <View className="mb-[14px]">
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
                placeholder="Adresse e-mail"
                placeholderTextColor={Colors.textTertiary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                accessibilityLabel="Email address"
                accessibilityHint="Enter your email address to sign in"
                className="flex-1 text-[15px] text-primary p-0"
              />
            </View>
          </View>

          {/* Password Input */}
          <View className="mb-6">
            <View
              className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
              style={{
                borderWidth: 1.5,
                borderColor: passwordFocused ? Colors.accent : Colors.gray200,
              }}
            >
              <Text className="text-base mr-[10px]" style={{ opacity: passwordFocused ? 1 : 0.4 }}>
                🔒
              </Text>
              <TextInput
                placeholder="Mot de passe"
                placeholderTextColor={Colors.textTertiary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                accessibilityLabel="Password"
                accessibilityHint="Enter your password to sign in"
                className="flex-1 text-[15px] text-primary p-0"
              />
            </View>
          </View>

          {/* Primary Button */}
          <Reanimated.View style={buttonAnimatedStyle}>
            <Pressable
              onPress={handleLogin}
              onPressIn={handleButtonPressIn}
              onPressOut={handleButtonPressOut}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: loading, busy: loading }}
              className="bg-primary rounded-xl py-[17px] items-center"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? (
                <ActivityIndicator color={Colors.accent} />
              ) : (
                <Text className="text-accent text-base font-bold tracking-wide">Se connecter</Text>
              )}
            </Pressable>
          </Reanimated.View>

          {/* Forgot Password */}
          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel="Forgot password"
              accessibilityHint="Navigate to password reset"
              className="items-center mt-[18px] mb-5"
            >
              <Text className="text-[#6B7C93] text-[13px]">Mot de passe oublié ?</Text>
            </TouchableOpacity>
          </Link>

          {/* OR Divider */}
          <View className="flex-row items-center mb-5">
            <View className="flex-1 h-px bg-surface-200" />
            <Text className="mx-3 text-[#94A3B8] text-xs font-medium">OU</Text>
            <View className="flex-1 h-px bg-surface-200" />
          </View>

          {/* Sign Up Row */}
          <View className="flex-row justify-center items-center gap-1">
            <Text className="text-[#6B7C93] text-sm">Pas encore de compte ? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity
                accessibilityRole="link"
                accessibilityLabel="Sign up"
                accessibilityHint="Navigate to create a new account"
              >
                <Text className="text-accent text-sm font-bold">S&apos;inscrire</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
