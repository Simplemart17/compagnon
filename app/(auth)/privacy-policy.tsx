import { ScrollView, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Colors } from "@/src/lib/design";

const LAST_UPDATED = "March 1, 2026";

interface Section {
  heading: string;
  body: string;
}

const sections: Section[] = [
  {
    heading: "1. Who We Are",
    body: 'Companion ("we", "us", "our") is an AI-powered French language learning application. By using Companion, you agree to the collection and use of information described in this policy.',
  },
  {
    heading: "2. Information We Collect",
    body: 'Account information: your email address and display name when you create an account.\n\nLearning data: exercises you complete, scores, daily activity, streaks, and your CEFR level progress -- used solely to personalise your learning experience.\n\nVoice recordings: audio captured during pronunciation assessments and voice conversation sessions. Audio is streamed to our secure servers for real-time processing and is not retained after the session ends.\n\nConversation transcripts: text transcripts of your voice and text conversations with the AI companion, including corrections. These are stored to generate your learning summary and improve personalisation.\n\nCompanion memory: facts and preferences extracted from your conversations (e.g. your name, topics you enjoy) to make future sessions more relevant.\n\nError patterns: categories of recurring mistakes (e.g. "subject-verb agreement") used to generate targeted practice exercises.\n\nDevice information: general technical information (OS version, app version) collected automatically by our error monitoring provider for crash reporting.',
  },
  {
    heading: "3. How We Use Your Information",
    body: "We use your data exclusively to:\n\n\u2022 Provide and personalise the language learning experience\n\u2022 Track your progress and maintain your learning streak\n\u2022 Generate AI-powered exercises, conversations, and feedback\n\u2022 Assess your pronunciation and identify areas for improvement\n\u2022 Remember preferences and facts to make conversations more natural\n\u2022 Detect and fix crashes and technical issues\n\nWe do not sell your data, use it for advertising, or share it with third parties except as described in Section 4.",
  },
  {
    heading: "4. Third-Party Services",
    body: "Companion relies on the following third-party providers to deliver its features. Each provider's own privacy policy governs their data practices.\n\nSupabase (supabase.com): Our database and authentication provider. Your account data and learning history are stored on Supabase infrastructure.\n\nOpenAI (openai.com): Powers AI conversation, exercise generation, text-to-speech, and companion memory embeddings. Conversation content is sent to OpenAI's API for processing per their usage policies.\n\nMicrosoft Azure Speech (azure.microsoft.com): Powers pronunciation assessment. Audio clips are transmitted to Azure for phoneme-level scoring.\n\nSentry (sentry.io): Crash reporting and error monitoring. Device metadata and anonymised error information may be shared with Sentry.",
  },
  {
    heading: "5. Data Retention",
    body: "Your data is retained for as long as your account is active. You may request deletion of your account and all associated data at any time by contacting us at privacy@companion.app. Upon deletion, your data is permanently removed from our systems within 30 days.",
  },
  {
    heading: "6. Data Security",
    body: "All data in transit is encrypted using TLS. Data at rest is protected using industry-standard encryption provided by Supabase. Access to your data is restricted through Row-Level Security policies -- each user can only access their own records. AI API keys are stored exclusively on our server infrastructure and are never transmitted to your device.",
  },
  {
    heading: "7. Children's Privacy",
    body: "Companion is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us and we will delete it promptly.",
  },
  {
    heading: "8. Your Rights",
    body: "Depending on your location, you may have the right to:\n\n\u2022 Access the personal data we hold about you\n\u2022 Correct inaccurate data\n\u2022 Request deletion of your data\n\u2022 Object to or restrict processing of your data\n\u2022 Data portability\n\nTo exercise any of these rights, contact us at privacy@companion.app.",
  },
  {
    heading: "9. Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or via email. Continued use of Companion after changes take effect constitutes your acceptance of the updated policy.",
  },
  {
    heading: "10. Contact",
    body: "If you have questions about this Privacy Policy or how we handle your data, please contact us at:\n\nprivacy@companion.app",
  },
];

export default function AuthPrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header with back button */}
      <View className="flex-row items-center px-4 py-3 border-b border-surface-300">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="min-h-[44px] min-w-[44px] justify-center"
        >
          <Text className="text-base text-primary font-semibold">{"\u2190"} Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[22px] font-extrabold text-primary mb-1">Privacy Policy</Text>
        <Text style={{ color: Colors.gray500 }} className="text-[13px] mb-7">
          Last updated: {LAST_UPDATED}
        </Text>

        {sections.map((section) => (
          <View key={section.heading} className="mb-6">
            <Text className="text-[15px] font-bold text-primary mb-2">{section.heading}</Text>
            <Text style={{ color: Colors.gray700 }} className="text-sm leading-[22px]">
              {section.body}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
