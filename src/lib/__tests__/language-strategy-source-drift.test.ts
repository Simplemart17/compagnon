/**
 * Story 14-1 — Language Strategy Rewrite source-drift detector.
 *
 * Closes audit P1-20 (bilingual UI chaos) + P2-11 (onboarding mixed-
 * language) by pinning, per touched screen + shared component, that:
 *
 *   - The legacy French chrome string is GONE from the comment-stripped
 *     source (NEGATIVE-pin).
 *   - The English replacement is PRESENT (POSITIVE-pin — defends against
 *     Story 13-2 P11 vacuous-pin: a regression that DELETES the string
 *     altogether would pass the negative-pin without the positive-pin).
 *
 * Operator decision (Decision Matrix row D1, 2026-05-06): English UI
 * chrome + French learning content; no bilingual toggle in v1. All Q1-Q5
 * operator-decision items resolved per AC #11 recommendations:
 *
 *   Q1 — TranscriptView speaker labels: convert ("You" / "Companion").
 *   Q2 — Brand name: standardize on "Companion" (English).
 *   Q3 — Login tagline: convert to "Speak. Learn. Master."
 *   Q4 — LEVEL_CONGRATS: convert to English equivalents.
 *   Q5 — Story 12-8 password-policy + Story 12-9 EmailVerificationGate:
 *        convert under the EN-UI rule (audit mandate is "no bilingual
 *        UI chaos"; keeping FR on signup while every other surface is
 *        EN re-introduces the chaos).
 *
 * Pattern: Story 12-2 P12 comment-stripped read of source-on-disk +
 * Story 12-12 M1 lessons on regex tolerance (word-boundary / substring
 * matches that survive punctuation drift).
 *
 * Method: each touched file's POSITIVE-pin asserts the new EN string
 * is present in the source; the NEGATIVE-pin asserts the legacy FR
 * string is gone. The drift detector runs against the comment-stripped
 * source so JSDoc / inline comments that mention the legacy FR string
 * (intentionally retained as historical context) do not trip the
 * negative guard.
 *
 * Numerical baseline (2026-05-15 implementation): ~95 chrome strings
 * converted across ~16 source files; ~21 paired negative+positive cases
 * here plus 1 global negative sweep = ~22 Jest-reported cases.
 */

import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "..", "..", "..");

// Story 12-2 P12 pattern — strip both block (`/* */`) and line (`//`)
// comments so commentary referencing the legacy FR string doesn't
// trip the negative guard.
const COMMENT_STRIP_RE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

function readScreen(relPath: string): string {
  const absPath = join(PROJECT_ROOT, relPath);
  const raw = readFileSync(absPath, "utf8");
  return raw.replace(COMMENT_STRIP_RE, "");
}

describe("Story 14-1 — chrome strings converted to English (per touched file)", () => {
  // ============================================================
  // Onboarding flow
  // ============================================================
  it("app/onboarding/index.tsx: step titles + CTA labels converted", () => {
    const src = readScreen("app/onboarding/index.tsx");
    // Step titles
    expect(src).not.toMatch(/Votre niveau actuel/);
    expect(src).toMatch(/Your current level/);
    expect(src).not.toMatch(/Quel est votre objectif/);
    expect(src).toMatch(/What is your goal\?/);
    expect(src).not.toMatch(/Objectif quotidien/);
    expect(src).toMatch(/Daily goal/);
    // CTA labels
    expect(src).not.toMatch(/Passer le test de placement/);
    expect(src).toMatch(/Take the placement test/);
    expect(src).not.toMatch(/Commencer l[''](apprentissage|enseignement)/);
    expect(src).toMatch(/Start learning/);
    // Arrow in source is the `→` escape sequence; tolerate either form.
    expect(src).not.toMatch(/Continuer/);
    expect(src).toMatch(/Continue/);
  });

  it("app/onboarding/placement-test.tsx: headers + CTAs + LEVEL_CONGRATS converted", () => {
    const src = readScreen("app/onboarding/placement-test.tsx");
    // Header
    expect(src).not.toMatch(/TEST DE PLACEMENT/);
    expect(src).toMatch(/PLACEMENT TEST/);
    // Error screen
    expect(src).not.toMatch(/Une erreur est survenue/);
    expect(src).toMatch(/Something went wrong/);
    // Buttons (multi-line JSX puts the text on its own line, so use
    // word-boundary not `>X<`)
    expect(src).not.toMatch(/Retour\s*<\/Text>/);
    expect(src).toMatch(/Back\s*<\/Text>/);
    expect(src).not.toMatch(/Réessayer/);
    expect(src).toMatch(/>Retry<\/Text>/);
    // Results screen
    expect(src).not.toMatch(/VOTRE NIVEAU/);
    expect(src).toMatch(/YOUR LEVEL/);
    expect(src).not.toMatch(/PERFORMANCE PAR NIVEAU/);
    expect(src).toMatch(/PERFORMANCE BY LEVEL/);
    expect(src).not.toMatch(/Commencer l'apprentissage !/);
    expect(src).toMatch(/Start learning!/);
    expect(src).not.toMatch(/Voir les résultats/);
    expect(src).toMatch(/View results/);
    expect(src).not.toMatch(/Question suivante/);
    expect(src).toMatch(/Next question/);
    // LEVEL_CONGRATS (Q4)
    expect(src).not.toMatch(/"Bonjour !"/);
    expect(src).not.toMatch(/"Très bien !"/);
    expect(src).not.toMatch(/"Bravo !"/);
    expect(src).not.toMatch(/"Magnifique !"/);
    expect(src).not.toMatch(/"Parfait !"/);
  });

  // ============================================================
  // Home + practice + mock-test + conversation surfaces
  // ============================================================
  it("app/(tabs)/home/index.tsx: cards + section headers + empty states converted", () => {
    const src = readScreen("app/(tabs)/home/index.tsx");
    expect(src).not.toMatch(/Parlez avec Compagnon/);
    expect(src).toMatch(/Talk with Companion/);
    expect(src).not.toMatch(/Conversez en temps réel/);
    expect(src).toMatch(/Real-time conversation/);
    expect(src).not.toMatch(/Aujourd'hui/);
    expect(src).toMatch(/>\s*Today\s*</);
    expect(src).not.toMatch(/Mes compétences/);
    expect(src).toMatch(/My skills/);
    expect(src).not.toMatch(/Commencez un exercice/);
    expect(src).toMatch(/Start an exercise/);
    expect(src).not.toMatch(/Pratiquez chaque jour/);
    expect(src).toMatch(/Practice daily/);
    expect(src).not.toMatch(/Bonjour\{firstName/);
    expect(src).toMatch(/Hello\{firstName/);
    expect(src).not.toMatch(/Impossible de charger le plan/);
    expect(src).toMatch(/Could not load the plan/);
  });

  it("app/(tabs)/practice/index.tsx: VEDETTE + Vocabulaire + Entraînement converted", () => {
    const src = readScreen("app/(tabs)/practice/index.tsx");
    expect(src).not.toMatch(/>VEDETTE</);
    expect(src).toMatch(/>FEATURED</);
    expect(src).not.toMatch(/>Vocabulaire</);
    expect(src).toMatch(/>Vocabulary</);
    expect(src).not.toMatch(/>Entraînement</);
    expect(src).toMatch(/>Practice</);
    expect(src).not.toMatch(/Choisissez une compétence/);
    expect(src).toMatch(/Choose a skill to practice/);
  });

  it("app/(tabs)/mock-test/index.tsx: badge + description + section label converted", () => {
    const src = readScreen("app/(tabs)/mock-test/index.tsx");
    expect(src).not.toMatch(/COMPRÉHENSION COMPLÈTE/);
    expect(src).toMatch(/FULL COMPREHENSION/);
    expect(src).not.toMatch(/2 sections de compréhension/);
    expect(src).toMatch(/2 comprehension sections/);
    expect(src).not.toMatch(/Sections individuelles/);
    expect(src).toMatch(/Individual sections/);
    expect(src).not.toMatch(/Bientôt disponible/);
    expect(src).toMatch(/Coming soon/);
    expect(src).not.toMatch(/Production écrite et orale/);
    expect(src).toMatch(/Written and spoken production/);
  });

  it("app/(tabs)/mock-test/[testId].tsx: section-transition overlay copy converted (Story 13-4 holdover)", () => {
    const src = readScreen("app/(tabs)/mock-test/[testId].tsx");
    expect(src).not.toMatch(/Préparation de la section suivante\.\.\./);
    expect(src).toMatch(/Preparing next section/);
  });

  it("app/(tabs)/mock-test/results.tsx: SECTION_LABELS converted to English", () => {
    const src = readScreen("app/(tabs)/mock-test/results.tsx");
    expect(src).not.toMatch(/Compréhension Orale/);
    expect(src).not.toMatch(/Compréhension Écrite/);
    expect(src).not.toMatch(/Structures de la Langue/);
    expect(src).toMatch(/Listening Comprehension/);
    expect(src).toMatch(/Reading Comprehension/);
    expect(src).toMatch(/Language Structures/); // R1-M4: missing POSITIVE pin
  });

  it("app/(tabs)/mock-test/speaking.tsx: Tâche converted to Task (R1-M1)", () => {
    const src = readScreen("app/(tabs)/mock-test/speaking.tsx");
    expect(src).not.toMatch(/Tâche \{state\.taskNumber\}/);
    expect(src).toMatch(/Task \{state\.taskNumber\}/);
  });

  it("src/hooks/use-daily-briefing.ts: Bonjour/Bonsoir greeting converted (R1-H5)", () => {
    const src = readScreen("src/hooks/use-daily-briefing.ts");
    expect(src).not.toMatch(/return hour < 18 \? "Bonjour" : "Bonsoir"/);
    expect(src).not.toMatch(/"Bonjour"/);
    expect(src).not.toMatch(/"Bonsoir"/);
    expect(src).toMatch(/Good (morning|afternoon|evening)/);
  });

  it("src/components/profile/cefr-progression-chart.tsx: empty-state copy converted (R1-H8)", () => {
    const src = readScreen("src/components/profile/cefr-progression-chart.tsx");
    expect(src).not.toMatch(/Complétez des exercices/);
    expect(src).not.toMatch(/progression au fil du temps/);
    expect(src).toMatch(/Complete exercises to track your progression/);
  });

  it("src/components/home/TodayPlanItem.tsx: skeleton accessibilityLabel converted (R1-M6)", () => {
    const src = readScreen("src/components/home/TodayPlanItem.tsx");
    expect(src).not.toMatch(/Chargement du plan du jour/);
    expect(src).toMatch(/Loading today's plan/);
  });

  it("R1-H1+H2: profile/index.tsx StatTile labels + SKILL_LABELS.fr converted to .en", () => {
    const src = readScreen("app/(tabs)/profile/index.tsx");
    expect(src).not.toMatch(/label="Exercices"/);
    expect(src).not.toMatch(/label="Pratique"/);
    expect(src).toMatch(/label="Exercises"/);
    expect(src).toMatch(/label="Practice"/);
    // SKILL_LABELS[skill]?.fr usages flipped to .en (H2)
    expect(src).not.toMatch(/SKILL_LABELS\[skill\]\?\.fr/);
    expect(src).toMatch(/SKILL_LABELS\[skill\]\?\.en/);
  });

  it("R1-H2: home/index.tsx SKILL_LABELS.fr usages flipped to .en", () => {
    const src = readScreen("app/(tabs)/home/index.tsx");
    expect(src).not.toMatch(/SKILL_LABELS\[skill\.skill\]\?\.fr/);
    expect(src).toMatch(/SKILL_LABELS\[skill\.skill\]\?\.en/);
  });

  it("R1-H3: mock-test/index.tsx ComingSoonCard + SectionCard render EN primary (nameSub) not FR (nameFr)", () => {
    const src = readScreen("app/(tabs)/mock-test/index.tsx");
    // The primary big-text label inside the cards is now nameSub (EN);
    // pre-R1 it was nameFr (FR like "Compréhension Orale").
    expect(src).not.toMatch(/font-bold text-primary">\{nameFr\}/);
    expect(src).toMatch(/font-bold text-primary">\{nameSub\}/);
  });

  it("R1-H4: COMPAGNON uppercase brand label converted to COMPANION (home + onboarding)", () => {
    const home = readScreen("app/(tabs)/home/index.tsx");
    const onboarding = readScreen("app/onboarding/index.tsx");
    expect(home).not.toMatch(/>COMPAGNON</);
    expect(home).toMatch(/>COMPANION</);
    expect(onboarding).not.toMatch(/COMPAGNON\s*<\/Text>/);
    expect(onboarding).toMatch(/COMPANION\s*<\/Text>/);
  });

  it("R1-H6: login.tsx Sign Up row converted (Pas encore de compte + S'inscrire)", () => {
    const src = readScreen("app/(auth)/login.tsx");
    expect(src).not.toMatch(/Pas encore de compte/);
    expect(src).not.toMatch(/S&apos;inscrire/);
    expect(src).not.toMatch(/S'inscrire/);
    expect(src).toMatch(/Don&apos;t have an account/);
    expect(src).toMatch(/>Sign up</);
  });

  it("R1-H7: settings.tsx Modifier + Supprimer définitivement + Supprimer mon compte converted", () => {
    const src = readScreen("app/(tabs)/profile/settings.tsx");
    expect(src).not.toMatch(/>\s*Modifier\s*</);
    expect(src).not.toMatch(/Supprimer définitivement/);
    expect(src).not.toMatch(/Supprimer mon compte/);
    expect(src).toMatch(/>\s*Edit\s*</);
    expect(src).toMatch(/Delete permanently/);
    expect(src).toMatch(/Delete my account/);
  });

  it("R1-M5: home/index.tsx weekday locale switched from 'fr' to 'en'", () => {
    const src = readScreen("app/(tabs)/home/index.tsx");
    expect(src).not.toMatch(/toLocaleDateString\("fr"/);
    expect(src).toMatch(/toLocaleDateString\("en"/);
  });

  it("app/(tabs)/conversation/index.tsx: hero heading converted (titleFr content preserved)", () => {
    const src = readScreen("app/(tabs)/conversation/index.tsx");
    // Chrome converted
    expect(src).not.toMatch(/^Parlez avec Compagnon$/m);
    expect(src).toMatch(/Talk with Companion/);
    // Content preserved: titleFr / TOPIC_EMOJIS keys (French topic names)
    // are content, NOT chrome — verify they're still consumed (positive
    // pin).
    expect(src).toMatch(/titleFr/);
  });

  it("app/(tabs)/conversation/history.tsx: empty-state copy converted (Q2 brand-name standardization)", () => {
    const src = readScreen("app/(tabs)/conversation/history.tsx");
    expect(src).not.toMatch(/first chat with Compagnon/);
    expect(src).toMatch(/first chat with Companion/);
  });

  // ============================================================
  // Practice screens (grammar happy-state)
  // ============================================================
  it("app/(tabs)/practice/grammar.tsx: completion praise converted", () => {
    const src = readScreen("app/(tabs)/practice/grammar.tsx");
    expect(src).not.toMatch(/"Parfait !"/);
    expect(src).not.toMatch(/"Bon travail !"/);
    expect(src).toMatch(/"Perfect!"/);
    expect(src).toMatch(/"Nice work!"/);
  });

  // ============================================================
  // Profile screens
  // ============================================================
  it("app/(tabs)/profile/index.tsx: section + stat labels + empty-state copy converted", () => {
    const src = readScreen("app/(tabs)/profile/index.tsx");
    expect(src).not.toMatch(/Mes compétences/);
    expect(src).toMatch(/My skills/);
    expect(src).not.toMatch(/exercices complétés/);
    expect(src).toMatch(/exercises completed/);
    expect(src).not.toMatch(/unit="jours"/);
    expect(src).toMatch(/unit="days"/);
    expect(src).not.toMatch(/label="Série"/);
    expect(src).toMatch(/label="Streak"/);
    expect(src).not.toMatch(/À améliorer/);
    expect(src).toMatch(/Needs work/);
    expect(src).not.toMatch(/Aucune erreur détectée/);
    expect(src).toMatch(/No errors detected/);
    expect(src).not.toMatch(/"Utilisateur"/);
    expect(src).toMatch(/"User"/);
    expect(src).not.toMatch(/Se déconnecter/);
    expect(src).toMatch(/>Sign out</);
  });

  it("app/(tabs)/profile/settings.tsx: ~14 section labels + buttons + placeholders + links converted", () => {
    const src = readScreen("app/(tabs)/profile/settings.tsx");
    // Section labels
    expect(src).not.toMatch(/Apprentissage/);
    expect(src).toMatch(/>Learning</);
    expect(src).not.toMatch(/>Compte</);
    expect(src).toMatch(/>Account</);
    expect(src).not.toMatch(/>Données</);
    expect(src).toMatch(/>Data</);
    expect(src).not.toMatch(/>À propos</);
    expect(src).toMatch(/>About</);
    // Card labels
    expect(src).not.toMatch(/>Niveau actuel</);
    expect(src).toMatch(/>Current level</);
    expect(src).not.toMatch(/>Niveau cible</);
    expect(src).toMatch(/>Target level</);
    expect(src).not.toMatch(/>Objectif quotidien</);
    expect(src).toMatch(/>Daily goal</);
    expect(src).not.toMatch(/Nom d&apos;affichage/);
    expect(src).toMatch(/>Display name</);
    expect(src).not.toMatch(/>Adresse e-mail</);
    expect(src).toMatch(/>Email address</);
    // Inputs / buttons
    expect(src).not.toMatch(/placeholder="Votre prénom"/);
    expect(src).toMatch(/placeholder="Your first name"/);
    expect(src).not.toMatch(/>Enregistrer</);
    expect(src).toMatch(/>Save</);
    expect(src).not.toMatch(/>Annuler</);
    expect(src).toMatch(/>\s*Cancel\s*</);
    expect(src).not.toMatch(/"Non défini"/);
    expect(src).toMatch(/"Not set"/);
    expect(src).not.toMatch(/Politique de confidentialité/);
    expect(src).toMatch(/Privacy policy/);
    expect(src).not.toMatch(/Conditions d&apos;utilisation/);
    expect(src).toMatch(/Terms of service/);
    // "View →" text (the arrow is the `→` escape sequence; the
    // whitespace-tolerant match accepts the text wherever it lands).
    expect(src).not.toMatch(/\bVoir \{/);
    expect(src).toMatch(/\bView \{/);
    expect(src).not.toMatch(/Exporter mes données/);
    expect(src).toMatch(/Export my data/);
    expect(src).not.toMatch(/>Paramètres</);
    expect(src).toMatch(/>← Settings</);
    expect(src).not.toMatch(/Se déconnecter/);
    expect(src).toMatch(/>Sign out</);
  });

  // ============================================================
  // Auth screens (Q2 brand-name standardization on "Companion")
  // ============================================================
  it("app/(auth)/login.tsx: brand + tagline + card title + placeholders + button + forgot-link converted", () => {
    const src = readScreen("app/(auth)/login.tsx");
    // Q2 brand standardization
    expect(src).not.toMatch(/>\s*Compagnon\s*</);
    expect(src).toMatch(/>\s*Companion\s*</);
    // Q3 tagline
    expect(src).not.toMatch(/Parlez\. Apprenez\. Maîtrisez\./);
    expect(src).toMatch(/Speak\. Learn\. Master\./);
    // Card title
    expect(src).not.toMatch(/>Bon retour</);
    expect(src).toMatch(/>Welcome back</);
    // Placeholders
    expect(src).not.toMatch(/placeholder="Adresse e-mail"/);
    expect(src).toMatch(/placeholder="Email address"/);
    expect(src).not.toMatch(/placeholder="Mot de passe"/);
    expect(src).toMatch(/placeholder="Password"/);
    // Buttons
    expect(src).not.toMatch(/>Se connecter</);
    expect(src).toMatch(/>Sign in</);
    expect(src).not.toMatch(/Mot de passe oublié \?/);
    expect(src).toMatch(/Forgot password\?/);
  });

  it("app/(auth)/signup.tsx: brand + tagline + card title + placeholders + button + legal converted", () => {
    const src = readScreen("app/(auth)/signup.tsx");
    expect(src).not.toMatch(/>\s*Compagnon\s*</);
    expect(src).toMatch(/>\s*Companion\s*</);
    expect(src).not.toMatch(/Commencez votre voyage/);
    expect(src).toMatch(/Start your journey/);
    expect(src).not.toMatch(/>Créer un compte</);
    expect(src).toMatch(/>Create account</);
    expect(src).not.toMatch(/placeholder="Nom complet"/);
    expect(src).toMatch(/placeholder="Full name"/);
    expect(src).not.toMatch(/Créer mon compte/);
    expect(src).toMatch(/Create my account/);
    expect(src).not.toMatch(/En créant un compte/);
    expect(src).toMatch(/By creating an account/);
    expect(src).not.toMatch(/Déjà un compte/);
    expect(src).toMatch(/Already have an account/);
    // Sign-in link
    expect(src).not.toMatch(/>Se connecter</);
    expect(src).toMatch(/>Sign in</);
  });

  it("app/(auth)/forgot-password.tsx: brand + tagline + body + button + back-link converted", () => {
    const src = readScreen("app/(auth)/forgot-password.tsx");
    expect(src).not.toMatch(/>\s*Compagnon\s*</);
    expect(src).toMatch(/>\s*Companion\s*</);
    expect(src).not.toMatch(/Récupérez votre accès/);
    expect(src).toMatch(/Recover your account/);
    expect(src).not.toMatch(/Mot de passe oublié/);
    expect(src).toMatch(/Forgot password/);
    expect(src).not.toMatch(/Saisissez votre adresse e-mail/);
    expect(src).toMatch(/Enter your email address/);
    expect(src).not.toMatch(/Envoyer le lien/);
    expect(src).toMatch(/Send link/);
    expect(src).not.toMatch(/← Retour/);
    expect(src).toMatch(/← Back/);
  });

  // ============================================================
  // Shared components (Q1 speaker labels + Q2 brand)
  // ============================================================
  it("src/components/conversation/TranscriptView.tsx: speaker labels converted (Q1 + Q2)", () => {
    const src = readScreen("src/components/conversation/TranscriptView.tsx");
    expect(src).not.toMatch(/"Vous"\s*:\s*"Compagnon"/);
    expect(src).toMatch(/"You"\s*:\s*"Companion"/);
    // The "Compagnon" header occurrences (lines 205 + 246) become "Companion".
    expect(src).not.toMatch(/>\s*Compagnon\s*</);
    expect(src).toMatch(/>\s*Companion\s*</);
  });

  it("src/components/conversation/CorrectionBubble.tsx: section label converted", () => {
    const src = readScreen("src/components/conversation/CorrectionBubble.tsx");
    expect(src).not.toMatch(/Compagnon noticed/);
    expect(src).toMatch(/Companion noticed/);
  });

  it("src/components/home/CompanionMessage.tsx: brand label converted", () => {
    const src = readScreen("src/components/home/CompanionMessage.tsx");
    expect(src).not.toMatch(/>\s*Compagnon\s*</);
    expect(src).toMatch(/>\s*Companion\s*</);
  });

  it("src/components/common/SkillCard.tsx: render order flips so EN is primary (Q2 + chrome rule)", () => {
    const src = readScreen("src/components/common/SkillCard.tsx");
    // The big primary label is now titleEn, with titleFr as the small
    // pedagogical-reinforcement secondary line.
    expect(src).toMatch(/text-base font-bold[^<]*\{titleEn\}/);
    // accessibilityLabel no longer contains the FR-then-EN concatenation.
    expect(src).not.toMatch(/\$\{titleFr\}\s*-\s*\$\{titleEn\}/);
    expect(src).toMatch(/accessibilityLabel=\{`\$\{titleEn\}/);
  });

  // ============================================================
  // Story 12-9 EmailVerificationGate (Q5 — convert)
  // ============================================================
  it("src/components/auth/EmailVerificationGate.tsx: Q5 — FR strings converted to English", () => {
    const src = readScreen("src/components/auth/EmailVerificationGate.tsx");
    // Heading + body
    expect(src).not.toMatch(/Vérifiez votre adresse e-mail/);
    expect(src).toMatch(/Verify your email address/);
    expect(src).not.toMatch(/Nous avons envoyé un lien de vérification/);
    expect(src).toMatch(/We sent a verification link/);
    // Button labels
    expect(src).not.toMatch(/"Renvoyer l'e-mail"/);
    expect(src).toMatch(/"Resend email"/);
    expect(src).not.toMatch(/"Adresse e-mail manquante"/);
    expect(src).toMatch(/"Email address missing"/);
    expect(src).not.toMatch(/"J'ai vérifié — actualiser"/);
    expect(src).toMatch(/"I've verified — refresh"/);
    expect(src).not.toMatch(/"Se déconnecter"/);
    expect(src).toMatch(/"Sign out"/);
    // Alert titles (3 occurrences of "Erreur" + 1 of "Vérification non confirmée")
    expect(src).not.toMatch(/"Erreur"/);
    expect(src).toMatch(/"Error"/);
    expect(src).not.toMatch(/Vérification non confirmée/);
    expect(src).toMatch(/"Not verified yet"/);
  });

  // ============================================================
  // Story 12-8 password-policy (Q5 — convert)
  // ============================================================
  it("src/lib/password-policy.ts: Q5 — French canonicals converted + export names renamed", () => {
    const src = readScreen("src/lib/password-policy.ts");
    // Old export names absent
    expect(src).not.toMatch(/passwordPolicyReasonToFrenchMessage/);
    expect(src).not.toMatch(/getPwnedFrenchMessage/);
    expect(src).not.toMatch(/getGenericWeakPasswordFrenchMessage/);
    expect(src).not.toMatch(/FRENCH_MESSAGES/);
    // New EN-canonical exports present
    expect(src).toMatch(/passwordPolicyReasonToMessage/);
    expect(src).toMatch(/getPwnedMessage/);
    expect(src).toMatch(/getGenericWeakPasswordMessage/);
    // Message strings converted
    expect(src).not.toMatch(/Au moins .* caractères/);
    expect(src).toMatch(/At least .* characters/);
    expect(src).not.toMatch(/Au moins une minuscule/);
    expect(src).toMatch(/At least one lowercase letter/);
    expect(src).not.toMatch(/Au moins une majuscule/);
    expect(src).toMatch(/At least one uppercase letter/);
    expect(src).not.toMatch(/Au moins un chiffre/);
    expect(src).toMatch(/At least one digit/);
    expect(src).not.toMatch(/Ce mot de passe a été divulgué/);
    expect(src).toMatch(/This password has been exposed in a data breach/);
    expect(src).not.toMatch(/Mot de passe trop faible/);
    expect(src).toMatch(/Password is too weak/);
  });

  it("src/components/auth/PasswordStrengthIndicator.tsx: STRENGTH_LABELS converted to English", () => {
    const src = readScreen("src/components/auth/PasswordStrengthIndicator.tsx");
    expect(src).not.toMatch(/weak:\s*"Faible"/);
    expect(src).not.toMatch(/medium:\s*"Moyen"/);
    expect(src).not.toMatch(/strong:\s*"Fort"/);
    expect(src).toMatch(/weak:\s*"Weak"/);
    expect(src).toMatch(/medium:\s*"Medium"/);
    expect(src).toMatch(/strong:\s*"Strong"/);
    // Consumer uses the renamed helper.
    expect(src).toMatch(/passwordPolicyReasonToMessage/);
    expect(src).not.toMatch(/passwordPolicyReasonToFrenchMessage/);
  });

  it("src/lib/email-verification.ts: VERIFICATION_EMAIL_FALLBACK converted to English", () => {
    const src = readScreen("src/lib/email-verification.ts");
    expect(src).not.toMatch(/"votre adresse e-mail"/);
    expect(src).toMatch(/"your email address"/);
    // Renamed constant: no `_FR` suffix.
    expect(src).not.toMatch(/VERIFICATION_EMAIL_FALLBACK_FR/);
    expect(src).toMatch(/VERIFICATION_EMAIL_FALLBACK\b/);
  });

  // ============================================================
  // Global negative sweep — high-signal substrings that MUST be
  // gone from EVERY touched production file. Catches strings the
  // dev forgot to convert in a per-file basis. Excludes JSDoc /
  // inline comments via the comment-stripped read.
  // ============================================================
  it("global negative sweep — no leftover high-signal FR chrome substrings in any touched file (R1-M2 + M3 extended)", () => {
    const TOUCHED_FILES = [
      "app/onboarding/index.tsx",
      "app/onboarding/placement-test.tsx",
      "app/(tabs)/home/index.tsx",
      "app/(tabs)/practice/index.tsx",
      "app/(tabs)/practice/grammar.tsx",
      "app/(tabs)/mock-test/index.tsx",
      "app/(tabs)/mock-test/[testId].tsx",
      "app/(tabs)/mock-test/results.tsx",
      "app/(tabs)/mock-test/speaking.tsx", // R1-M1: speaking.tsx added
      "app/(tabs)/conversation/index.tsx",
      "app/(tabs)/conversation/history.tsx",
      "app/(tabs)/profile/index.tsx",
      "app/(tabs)/profile/settings.tsx",
      "app/(auth)/login.tsx",
      "app/(auth)/signup.tsx",
      "app/(auth)/forgot-password.tsx",
      "src/components/conversation/TranscriptView.tsx",
      "src/components/conversation/CorrectionBubble.tsx",
      "src/components/home/CompanionMessage.tsx",
      "src/components/home/TodayPlanItem.tsx", // R1-M3: TodayPlanItem accessibility label coverage
      "src/components/common/SkillCard.tsx",
      "src/components/profile/cefr-progression-chart.tsx", // R1-M3: progression chart empty-state
      "src/components/auth/EmailVerificationGate.tsx",
      "src/components/auth/PasswordStrengthIndicator.tsx",
      "src/hooks/use-daily-briefing.ts", // R1-M3: greeting helper runtime FR
      "src/lib/password-policy.ts",
      "src/lib/email-verification.ts",
    ];

    // High-signal FR substrings that should NOT appear in any touched
    // production-source file. These are the most-recognizable French
    // chrome strings; their continued presence in any file after Story
    // 14-1 + review-round-1 indicates a regression.
    const FORBIDDEN_FR_SUBSTRINGS = [
      "Mes compétences",
      "Aujourd'hui",
      "Apprentissage",
      'Compte"', // distinct from "Compagnon" — anchored to closing-quote
      "Annuler",
      "Enregistrer",
      "Réessayer",
      "Préparation de la section",
      "Entraînement",
      "Vocabulaire",
      "Parlez avec Compagnon",
      "Question suivante",
      "Bon retour",
      "Mot de passe oublié",
      "Adresse e-mail",
      "Créer un compte",
      "Se connecter",
      "Politique de confidentialité",
      "Conditions d'utilisation",
      "Vérifiez votre adresse",
      "Renvoyer l'e-mail",
      "passwordPolicyReasonToFrenchMessage",
      "getPwnedFrenchMessage",
      "FRENCH_MESSAGES",
      // R1-M2 additions — strings that escaped the initial inventory.
      "COMPAGNON", // uppercase brand variant (R1-H4)
      'label="Pratique"', // StatTile chrome (R1-H1) — anchored on attr so the `fr:"Pratique d'écho"` PRACTICE_LABELS content is not falsely flagged
      'label="Exercices"', // StatTile chrome (R1-H1)
      "Tâche {state", // mock-test/speaking.tsx (R1-M1) — anchored so the FR content of speaking prompts is not falsely flagged
      "Compréhension Orale", // mock-test/index.tsx SECTION cards (R1-H3) + results
      "Compréhension Écrite",
      "Maîtrise des structures",
      "Bonjour", // daily-briefing greeting (R1-H5)
      "Bonsoir",
      "Chargement", // TodayPlanItem skeleton (R1-M6)
      "Pas encore de compte", // login Sign Up row (R1-H6)
      "S'inscrire",
      "S&apos;inscrire",
      "Modifier", // settings Edit button (R1-H7)
      "Supprimer", // settings Delete buttons (R1-H7)
      "Complétez des exercices", // cefr-progression-chart empty state (R1-H8)
      "progression au fil du temps",
      "SKILL_LABELS[skill]?.fr", // R1-H2 — discourage future .fr rendering as chrome
      "SKILL_LABELS[skill.skill]?.fr",
      'toLocaleDateString("fr"', // R1-M5 — discourage fr-locale dynamic chrome
    ];

    const violations: { file: string; substring: string }[] = [];
    for (const file of TOUCHED_FILES) {
      const src = readScreen(file);
      for (const sub of FORBIDDEN_FR_SUBSTRINGS) {
        if (src.includes(sub)) {
          violations.push({ file, substring: sub });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
