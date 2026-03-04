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
    const { error } = await signUpWithEmail(email.trim(), password, fullName.trim());
    setLoading(false);

    if (error) {
      Alert.alert("Sign Up Failed", error.message);
    } else {
      Alert.alert(
        "Check Your Email",
        "We sent you a confirmation link. Please verify your email to continue."
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
          {/* Decorative top dots */}
          <View
            style={{
              flexDirection: "row",
              gap: 6,
              marginBottom: 20,
              opacity: 0.3,
            }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "#F5A623",
                }}
              />
            ))}
          </View>

          <Text
            style={{
              fontSize: 42,
              fontWeight: "800",
              color: "#FFFFFF",
              letterSpacing: -0.5,
              marginBottom: 10,
            }}
          >
            Compagnon
          </Text>

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
              color: "rgba(255,255,255,0.6)",
              fontStyle: "italic",
              letterSpacing: 0.3,
            }}
          >
            Commencez votre voyage
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
              paddingHorizontal: 28,
              paddingTop: 32,
              paddingBottom: insets.bottom + 24,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Card Title */}
            <Text
              style={{
                fontSize: 26,
                fontWeight: "800",
                color: "#1E3A5F",
                marginBottom: 24,
              }}
            >
              Créer un compte
            </Text>

            {/* Full Name Input */}
            <View style={{ marginBottom: 14 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#FFFFFF",
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: nameFocused ? "#F5A623" : "#E8E8E0",
                  paddingVertical: 16,
                  paddingHorizontal: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    marginRight: 10,
                    opacity: nameFocused ? 1 : 0.4,
                  }}
                >
                  👤
                </Text>
                <TextInput
                  placeholder="Nom complet"
                  placeholderTextColor="#AAAAAA"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color: "#1E3A5F",
                    padding: 0,
                  }}
                />
              </View>
            </View>

            {/* Email Input */}
            <View style={{ marginBottom: 14 }}>
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

            {/* Password Input */}
            <View style={{ marginBottom: 26 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#FFFFFF",
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: passwordFocused ? "#F5A623" : "#E8E8E0",
                  paddingVertical: 16,
                  paddingHorizontal: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    marginRight: 10,
                    opacity: passwordFocused ? 1 : 0.4,
                  }}
                >
                  🔒
                </Text>
                <TextInput
                  placeholder="Mot de passe (min. 6 caractères)"
                  placeholderTextColor="#AAAAAA"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
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
                onPress={handleSignUp}
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
                    Créer mon compte
                  </Text>
                )}
              </Pressable>
            </Reanimated.View>

            {/* Legal Notice */}
            <Text
              style={{
                fontSize: 11,
                color: "#999999",
                textAlign: "center",
                marginTop: 18,
                lineHeight: 17,
                paddingHorizontal: 8,
              }}
            >
              En créant un compte, vous acceptez nos{" "}
              <Text
                style={{ color: "#1E3A5F", fontWeight: "600" }}
                onPress={() => router.push("/(auth)/terms")}
              >
                Conditions d&apos;utilisation
              </Text>{" "}
              et notre{" "}
              <Text
                style={{ color: "#1E3A5F", fontWeight: "600" }}
                onPress={() => router.push("/(auth)/privacy-policy")}
              >
                Politique de confidentialité
              </Text>
              .
            </Text>

            {/* Sign In Row */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "center",
                marginTop: 20,
                gap: 4,
              }}
            >
              <Text style={{ color: "#666666", fontSize: 14 }}>Déjà un compte ? </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <Text
                    style={{
                      color: "#F5A623",
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    Se connecter
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </ScrollView>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
