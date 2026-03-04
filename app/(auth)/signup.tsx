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

import { useAuth } from "@/src/hooks/use-auth";
import { Colors } from "@/src/lib/design";

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

    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await signUpWithEmail(email.trim(), password, fullName.trim());
      if (error) {
        Alert.alert("Sign Up Failed", error.message);
      } else {
        Alert.alert(
          "Check Your Email",
          "We sent you a confirmation link. Please verify your email to continue."
        );
      }
    } catch (err) {
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

          <Text className="text-sm text-white/60 italic tracking-wide">Commencez votre voyage</Text>
        </View>

        {/* White Card */}
        <Reanimated.View
          style={[
            {
              flex: 1,
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              shadowColor: "#000",
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
            <Text className="text-[26px] font-extrabold text-primary mb-6">Créer un compte</Text>

            {/* Full Name Input */}
            <View className="mb-[14px]">
              <View
                className="flex-row items-center bg-white rounded-[14px] py-4 px-4"
                style={{
                  borderWidth: 1.5,
                  borderColor: nameFocused ? Colors.accent : Colors.gray200,
                }}
              >
                <Text className="text-base mr-[10px]" style={{ opacity: nameFocused ? 1 : 0.4 }}>
                  👤
                </Text>
                <TextInput
                  placeholder="Nom complet"
                  placeholderTextColor={Colors.textTertiary}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
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
                <Text
                  className="text-base mr-[10px]"
                  style={{ opacity: passwordFocused ? 1 : 0.4 }}
                >
                  🔒
                </Text>
                <TextInput
                  placeholder="Mot de passe (min. 6 caractères)"
                  placeholderTextColor={Colors.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  className="flex-1 text-[15px] text-primary p-0"
                />
              </View>
            </View>

            {/* Primary Button */}
            <Reanimated.View style={buttonAnimatedStyle}>
              <Pressable
                onPress={handleSignUp}
                onPressIn={handleButtonPressIn}
                onPressOut={handleButtonPressOut}
                disabled={loading}
                className="bg-primary rounded-xl py-[17px] items-center"
                style={{ opacity: loading ? 0.7 : 1 }}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <Text className="text-accent text-base font-bold tracking-wide">
                    Créer mon compte
                  </Text>
                )}
              </Pressable>
            </Reanimated.View>

            {/* Legal Notice */}
            <Text className="text-[11px] text-[#94A3B8] text-center mt-[18px] leading-[17px] px-2">
              En créant un compte, vous acceptez nos{" "}
              <Text
                className="text-primary font-semibold"
                onPress={() => router.push("/(auth)/terms")}
              >
                Conditions d&apos;utilisation
              </Text>{" "}
              et notre{" "}
              <Text
                className="text-primary font-semibold"
                onPress={() => router.push("/(auth)/privacy-policy")}
              >
                Politique de confidentialité
              </Text>
              .
            </Text>

            {/* Sign In Row */}
            <View className="flex-row justify-center items-center mt-5 gap-1">
              <Text className="text-[#6B7C93] text-sm">Déjà un compte ? </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel="Already have an account? Sign in"
                >
                  <Text className="text-accent text-sm font-bold">Se connecter</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </ScrollView>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
