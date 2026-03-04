import { ScrollView, View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const LAST_UPDATED = "March 1, 2026";

interface Section {
  heading: string;
  body: string;
}

const sections: Section[] = [
  {
    heading: "1. Acceptance of Terms",
    body: "By creating an account or using Companion, you agree to these Terms of Service and our Privacy Policy. If you do not agree, please do not use the app.",
  },
  {
    heading: "2. Description of Service",
    body: "Companion is an AI-powered French language learning application that provides voice conversation practice, structured exercises, pronunciation assessment, and progress tracking to help users prepare for the TCF (Test de Connaissance du Français) exam and improve general French proficiency.",
  },
  {
    heading: "3. Account Registration",
    body: "You must be at least 13 years old to create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to provide accurate information and to update it as necessary.",
  },
  {
    heading: "4. Acceptable Use",
    body: "You agree not to:\n\n• Use the service for any unlawful purpose\n• Attempt to reverse-engineer, decompile, or extract the app's source code\n• Use automated tools to scrape or overload the service\n• Impersonate other users or provide false identity information\n• Upload audio content intended to deceive or harm others\n• Attempt to circumvent rate limits or other usage controls\n• Use the service to generate content that is harmful, defamatory, or illegal",
  },
  {
    heading: "5. AI-Generated Content",
    body: "Companion uses artificial intelligence to generate exercises, feedback, and conversation responses. AI-generated content may occasionally be inaccurate or contain errors. You should not rely on AI-generated translations, grammar explanations, or feedback as a substitute for professional language instruction. We are not liable for errors in AI-generated content.",
  },
  {
    heading: "6. Privacy and Data",
    body: "Your use of Companion is also governed by our Privacy Policy, which is incorporated into these Terms by reference. By using Companion, you consent to the data practices described in the Privacy Policy, including transmission of voice audio and conversation text to third-party AI providers for processing.",
  },
  {
    heading: "7. Subscription and Payments",
    body: "Companion may offer free and premium features. Any fees for premium features will be clearly disclosed before purchase. Payments are processed through the App Store (Apple) or Google Play (Android) and are subject to their respective terms and refund policies.",
  },
  {
    heading: "8. Intellectual Property",
    body: "All content, trademarks, and technology in Companion (excluding AI-generated outputs and user-provided content) are owned by or licensed to us. You may not reproduce, distribute, or create derivative works without our written permission.\n\nYou retain ownership of any content you create within the app (e.g. your written exercises). By using the service, you grant us a limited licence to process and store your content solely to provide the service.",
  },
  {
    heading: "9. Disclaimer of Warranties",
    body: 'Companion is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the service will be uninterrupted, error-free, or that results from the service will be accurate. Your use of the service is at your sole risk.',
  },
  {
    heading: "10. Limitation of Liability",
    body: "To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of Companion, including but not limited to loss of data, loss of revenue, or failure to achieve language learning goals.",
  },
  {
    heading: "11. Modifications to the Service",
    body: "We reserve the right to modify, suspend, or discontinue the service at any time with or without notice. We are not liable to you or any third party for any modification, suspension, or discontinuation of the service.",
  },
  {
    heading: "12. Changes to These Terms",
    body: "We may update these Terms from time to time. We will notify you of material changes through the app or by email. Continued use of Companion after changes take effect constitutes your acceptance of the revised Terms.",
  },
  {
    heading: "13. Governing Law",
    body: "These Terms are governed by and construed in accordance with applicable law. Any disputes arising from these Terms shall be resolved through binding arbitration or in the courts of competent jurisdiction.",
  },
  {
    heading: "14. Contact",
    body: "If you have questions about these Terms, please contact us at:\n\nsupport@companion.app",
  },
];

export default function TermsScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F5F0" }} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: "800",
            color: "#1E3A5F",
            marginBottom: 4,
          }}
        >
          Terms of Service
        </Text>
        <Text style={{ fontSize: 13, color: "#999", marginBottom: 28 }}>
          Last updated: {LAST_UPDATED}
        </Text>

        {sections.map((section) => (
          <View key={section.heading} style={{ marginBottom: 24 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: "#1E3A5F",
                marginBottom: 8,
              }}
            >
              {section.heading}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: "#444",
                lineHeight: 22,
              }}
            >
              {section.body}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
